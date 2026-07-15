package ru.mindex.app.ui.screens.chat

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.mindex.app.data.model.Message
import ru.mindex.app.data.model.Plan
import ru.mindex.app.data.model.PlanningData
import ru.mindex.app.data.model.Thread
import ru.mindex.app.data.repository.ChatTurn
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.navigation.Routes
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.Muller
import java.io.File
import java.io.IOException
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.UUID

/** Фон экрана чата — #f0f0f0, как в AIChat.tsx. */
private val ChatBg = Color(0xFFF0F0F0)

/** Фразы индикатора «Мысль думает» — 1:1 с THINKING_PHRASES в AIChat.tsx. */
private val THINKING_PHRASES = listOf(
    "Думаю...", "Анализирую...", "Ищу в архиве...", "Формулирую...", "Пишу ответ...",
)

/** Состояние голосового ввода — зеркало VoiceState из useVoiceInput.ts. */
private enum class VoiceState { Idle, Recording, Processing, Error }

/** Держатель MediaRecorder вне Compose-состояния (UI на него не подписан). */
private class RecorderHolder {
    var recorder: MediaRecorder? = null
    var file: File? = null
    var startedAt: Long = 0L
}

/**
 * Экран диалога с Мыслью — порт src/components/AIChat.tsx.
 *
 * threadId == "new" → свежий тред (UUID создаётся здесь, персистится
 * при первом сообщении — как startNewThread в App.tsx). Иначе история
 * загружается из appViewModel.threads.
 */
@Composable
fun ChatScreen(appViewModel: AppViewModel, navController: NavHostController, threadId: String) {
    val container = appViewModel.container
    val chatRepo = container.chatRepository
    val dataRepo = container.dataRepository
    val json = container.json
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val actualThreadId = rememberSaveable(threadId) {
        if (threadId == "new") UUID.randomUUID().toString() else threadId
    }

    // Снимок треда на момент открытия; дальше экран — источник правды,
    // изменения зеркалятся в репозиторий через upsertThread (как в вебе).
    val initialThread = remember(actualThreadId) {
        appViewModel.threads.value.firstOrNull { it.id == actualThreadId }
    }

    var messages by remember { mutableStateOf(initialThread?.messages ?: emptyList()) }
    var title by remember { mutableStateOf(initialThread?.title ?: "Новая мысль") }
    var preview by remember { mutableStateOf(initialThread?.preview ?: "") }
    var summary by remember { mutableStateOf(initialThread?.summary) }
    var meaningful by remember { mutableStateOf(initialThread?.isMeaningful) }
    val createdAt = remember { initialThread?.createdAt ?: System.currentTimeMillis() }
    val source = remember { initialThread?.source ?: "thread" }
    val threadLabel = remember { initialThread?.label }

    var input by remember { mutableStateOf("") }
    var isTyping by remember { mutableStateOf(false) }
    var voiceState by remember { mutableStateOf(VoiceState.Idle) }
    var voiceError by remember { mutableStateOf<String?>(null) }
    val recorderHolder = remember { RecorderHolder() }

    val timeFormatter = remember { DateTimeFormatter.ofPattern("HH:mm") }
    fun ft(): String = LocalTime.now().format(timeFormatter)

    fun buildThread(): Thread = Thread(
        id = actualThreadId,
        title = title,
        preview = preview,
        messages = messages,
        createdAt = createdAt,
        updatedAt = System.currentTimeMillis(),
        source = source,
        label = threadLabel,
        summary = summary,
        isMeaningful = meaningful,
    )

    suspend fun persist() {
        dataRepo.upsertThread(buildThread())
    }

    // ─── Отправка сообщения — порт sendText() ────────────────────────────

    fun sendText(text: String) {
        if (text.isBlank() || isTyping) return
        val userMsg = Message(role = "user", content = text, time = ft())
        val isFirstMessage = messages.isEmpty()
        val history = messages + userMsg
        messages = history
        preview = if (text.length > 60) text.take(60) + "…" else text
        isTyping = true

        scope.launch {
            runCatching { persist() }
            runCatching { chatRepo.sendMessage(history, actualThreadId) }
                .onSuccess { turn ->
                    when (turn) {
                        is ChatTurn.Answer -> {
                            messages = messages + turn.turnMessages + turn.finalMessage
                            preview = turn.finalMessage.content.take(60) + "…"
                            runCatching { persist() }
                            if (isFirstMessage) {
                                launch {
                                    chatRepo.generateTitle(text, turn.finalMessage.content)?.let {
                                        title = it.take(60)
                                        runCatching { persist() }
                                    }
                                }
                            }
                        }

                        is ChatTurn.Planning -> {
                            messages = messages + turn.message
                            runCatching { persist() }
                        }
                    }
                }
                .onFailure { e ->
                    val content = if (e is IOException) {
                        "Ошибка сети: Не удалось отправить запрос (возможно, заблокировано WebView или нет интернета)."
                    } else {
                        "Ошибка: ${e.message ?: "Не удалось связаться с ИИ. Проверь интернет или настройки."}"
                    }
                    messages = messages + Message(role = "assistant", content = content, time = ft())
                    runCatching { persist() }
                }
            isTyping = false
        }
    }

    // ─── Планирование — порт handleAnswer / generatePlanFromAnswers ──────

    fun generatePlanFromAnswers(index: Int, planningData: PlanningData) {
        isTyping = true
        scope.launch {
            try {
                val answersText = planningData.questions.mapNotNull { q ->
                    planningData.answers?.get(q.id)?.let { "Вопрос: ${q.question}\nОтвет: $it" }
                }.joinToString("\n\n")

                val prompt = "Пользователь ответил на уточняющие вопросы:\n\n$answersText\n\n" +
                    "На основе этих ответов составь пошаговый план действий (to-do list).\n" +
                    "Отвечай СТРОГО в формате JSON:\n" +
                    "{\n  \"title\": \"Название плана\",\n  \"steps\": [\"шаг 1\", \"шаг 2\", ...]\n}"

                val turn = chatRepo.sendMessage(
                    messages + Message(role = "user", content = prompt, time = ft()),
                    actualThreadId,
                )
                val content = when (turn) {
                    is ChatTurn.Answer -> turn.finalMessage.content
                    is ChatTurn.Planning -> ""
                }
                if (content.isBlank()) error("AI вернул пустой ответ при генерации плана.")

                var jsonContent = content.trim()
                if (jsonContent.contains("```json")) {
                    jsonContent = jsonContent.substringAfter("```json").substringBefore("```").trim()
                } else if (jsonContent.contains("```")) {
                    jsonContent = jsonContent.substringAfter("```").substringBefore("```").trim()
                }
                val plan = json.decodeFromString(Plan.serializer(), jsonContent)

                val msg = messages.getOrNull(index)
                val pd = msg?.planningData
                if (msg != null && pd != null) {
                    messages = messages.toMutableList().also {
                        it[index] = msg.copy(planningData = pd.copy(plan = plan, status = "plan_generated"))
                    }
                    runCatching { persist() }
                }
            } catch (_: Exception) {
                // Как в вебе: ошибка генерации плана не роняет диалог.
            } finally {
                isTyping = false
            }
        }
    }

    fun handleAnswer(index: Int, questionId: String, answer: String) {
        val msg = messages.getOrNull(index) ?: return
        val pd = msg.planningData ?: return
        val newAnswers = (pd.answers ?: emptyMap()) + (questionId to answer)
        val allAnswered = pd.questions.all { newAnswers.containsKey(it.id) }
        val newPd = pd.copy(
            answers = newAnswers,
            status = if (allAnswered) "plan_generated" else pd.status,
        )
        messages = messages.toMutableList().also { it[index] = msg.copy(planningData = newPd) }
        scope.launch { runCatching { persist() } }
        if (allAnswered) generatePlanFromAnswers(index, newPd)
    }

    fun updatePlanStep(index: Int, stepIndex: Int, value: String) {
        val msg = messages.getOrNull(index) ?: return
        val pd = msg.planningData ?: return
        val plan = pd.plan ?: return
        if (stepIndex !in plan.steps.indices) return
        val steps = plan.steps.toMutableList().also { it[stepIndex] = value }
        messages = messages.toMutableList().also {
            it[index] = msg.copy(planningData = pd.copy(plan = plan.copy(steps = steps)))
        }
        // Персист — при «Принять»/«Отмена», чтобы не слать запрос на каждый символ.
    }

    fun handleAcceptPlan(index: Int) {
        val msg = messages.getOrNull(index) ?: return
        val pd = msg.planningData ?: return
        val plan = pd.plan ?: return
        messages = messages.toMutableList().also {
            it[index] = msg.copy(planningData = pd.copy(status = "accepted"))
        } + Message(
            role = "assistant",
            content = "Отлично! План добавлен в календарь. Ты найдешь его в списке задач со звездочкой.",
            time = ft(),
        )
        scope.launch {
            runCatching { chatRepo.acceptPlan(plan, actualThreadId) }
            runCatching { persist() }
        }
    }

    fun handleRejectPlan(index: Int) {
        val msg = messages.getOrNull(index) ?: return
        val pd = msg.planningData ?: return
        messages = messages.toMutableList().also {
            it[index] = msg.copy(planningData = pd.copy(status = "rejected"))
        } + Message(
            role = "assistant",
            content = "Хорошо, давай попробуем по-другому или просто продолжим общение.",
            time = ft(),
        )
        scope.launch { runCatching { persist() } }
    }

    // ─── Голосовой ввод — порт useVoiceInput.ts на MediaRecorder ─────────

    fun startRecording() {
        if (voiceState != VoiceState.Idle) return
        voiceError = null
        val file = File(context.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
        try {
            val rec = createMediaRecorder(context).apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioEncodingBitRate(128_000)
                setAudioSamplingRate(44_100)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            recorderHolder.recorder = rec
            recorderHolder.file = file
            recorderHolder.startedAt = System.currentTimeMillis()
            voiceState = VoiceState.Recording
        } catch (_: Exception) {
            recorderHolder.recorder?.let { runCatching { it.release() } }
            recorderHolder.recorder = null
            voiceError = "Не удалось записать звук."
            voiceState = VoiceState.Error
        }
    }

    fun stopRecording() {
        if (voiceState != VoiceState.Recording) return
        val rec = recorderHolder.recorder ?: return
        val file = recorderHolder.file
        val durationMs = System.currentTimeMillis() - recorderHolder.startedAt
        voiceState = VoiceState.Processing

        val stopped = runCatching { rec.stop() }.isSuccess
        runCatching { rec.release() }
        recorderHolder.recorder = null

        if (!stopped || durationMs < 300 || file == null || !file.exists() || file.length() == 0L) {
            file?.delete()
            voiceError = if (durationMs < 300) "Слишком короткая запись." else "Не удалось записать звук."
            voiceState = VoiceState.Error
            return
        }

        scope.launch {
            val text = chatRepo.transcribe(file)
            file.delete()
            if (text != null) {
                input = if (input.isBlank()) text else input + " " + text
                voiceState = VoiceState.Idle
            } else {
                voiceError = "Ошибка при транскрибации."
                voiceState = VoiceState.Error
            }
        }
    }

    val micPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            startRecording()
        } else {
            voiceError = "Нет доступа к микрофону."
            voiceState = VoiceState.Error
        }
    }

    fun onMicTap() {
        when (voiceState) {
            VoiceState.Recording -> stopRecording()
            VoiceState.Idle -> {
                val granted = ContextCompat.checkSelfPermission(
                    context, Manifest.permission.RECORD_AUDIO,
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) startRecording() else micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
            else -> Unit
        }
    }

    // Ошибка голосового ввода гаснет через 2 секунды — как в вебе.
    LaunchedEffect(voiceState) {
        if (voiceState == VoiceState.Error) {
            delay(2000)
            voiceState = VoiceState.Idle
            voiceError = null
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            recorderHolder.recorder?.let {
                runCatching { it.stop() }
                runCatching { it.release() }
            }
            recorderHolder.recorder = null
        }
    }

    // ─── Отправка и закрытие ──────────────────────────────────────────────

    fun handleSend() {
        val text = input.trim()
        if (text.isEmpty()) return
        input = ""
        sendText(text)
    }

    // Порт handleClose(): при выходе из содержательного диалога — резюме
    // в память Мысли. Запускаем в scope ViewModel: он переживёт экран.
    fun handleClose() {
        val snapshot = buildThread()
        if (snapshot.summary == null && snapshot.messages.count { it.role == "user" } >= 2) {
            appViewModel.viewModelScope.launch {
                chatRepo.summarize(snapshot.messages)?.let { s ->
                    dataRepo.upsertThread(snapshot.copy(summary = s, isMeaningful = true))
                }
            }
        }
        navController.popBackStack()
    }

    BackHandler { handleClose() }

    // ─── UI ───────────────────────────────────────────────────────────────

    val visibleMessages = messages.withIndex()
        .filter { it.value.role != "tool" && it.value.toolCalls == null }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size, isTyping) {
        val total = visibleMessages.size + if (isTyping) 1 else 0
        if (total > 0) listState.animateScrollToItem(total - 1)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(ChatBg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        // ─── Шапка ────────────────────────────────────────────
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            IconButton(onClick = { handleClose() }) {
                Icon(
                    imageVector = ChevronLeftIcon,
                    contentDescription = "Назад",
                    tint = MindexColors.TextPrimary,
                    modifier = Modifier.size(28.dp),
                )
            }
            IconButton(onClick = { navController.navigate(Routes.SETTINGS) }) {
                Icon(
                    imageVector = GearIcon,
                    contentDescription = "Настройки",
                    tint = Color(0x80222224),
                    modifier = Modifier.size(24.dp),
                )
            }
        }

        // ─── Лента сообщений / пустое состояние ───────────────
        if (visibleMessages.isEmpty() && !isTyping) {
            Column(
                Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    "есть мысли?",
                    style = MaterialTheme.typography.displaySmall,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Поделись тем, что на уме",
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(visibleMessages.size) { i ->
                    val (origIndex, message) = visibleMessages[i]
                    if (message.role == "user") {
                        UserMessage(message)
                    } else {
                        AssistantMessage(
                            message = message,
                            onAnswer = { qId, answer -> handleAnswer(origIndex, qId, answer) },
                            onUpdateStep = { sIdx, value -> updatePlanStep(origIndex, sIdx, value) },
                            onAccept = { handleAcceptPlan(origIndex) },
                            onReject = { handleRejectPlan(origIndex) },
                        )
                    }
                }
                if (isTyping) {
                    item {
                        Row(
                            Modifier.padding(start = 2.dp, bottom = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            MysliThinking()
                            Spacer(Modifier.width(10.dp))
                            ThinkingPhrase()
                        }
                    }
                }
            }
        }

        // ─── Панель ввода ──────────────────────────────────────
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = 8.dp, bottom = 16.dp),
        ) {
            voiceError?.let {
                Text(
                    it,
                    fontFamily = Muller,
                    fontSize = 12.sp,
                    color = MindexColors.Danger,
                    modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
                )
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(MindexColors.Surface)
                    .padding(16.dp),
            ) {
                BasicTextField(
                    value = input,
                    onValueChange = { input = it },
                    textStyle = TextStyle(
                        fontFamily = Muller,
                        fontSize = 15.sp,
                        lineHeight = 23.sp,
                        color = MindexColors.TextPrimary,
                    ),
                    cursorBrush = SolidColor(MindexColors.Accent),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 24.dp, max = 120.dp),
                    decorationBox = { inner ->
                        Box {
                            if (input.isEmpty()) {
                                Text(
                                    "Есть мысли?",
                                    fontFamily = Muller,
                                    fontSize = 15.sp,
                                    color = MindexColors.Text30,
                                )
                            }
                            inner()
                        }
                    },
                )
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // Микрофон: idle → серый, запись → красный, обработка → спиннер.
                    val micBg = when (voiceState) {
                        VoiceState.Recording -> MindexColors.Danger
                        VoiceState.Processing -> Color(0x26222224)
                        else -> Color(0x14222224)
                    }
                    Box(
                        Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(micBg)
                            .clickable(enabled = voiceState != VoiceState.Processing) { onMicTap() },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (voiceState == VoiceState.Processing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(15.dp),
                                color = MindexColors.TextPrimary,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Icon(
                                imageVector = MicIcon,
                                contentDescription = if (voiceState == VoiceState.Recording) {
                                    "Остановить запись"
                                } else {
                                    "Голосовой ввод"
                                },
                                tint = if (voiceState == VoiceState.Recording) Color.White else Color(0x80222224),
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    }
                    Spacer(Modifier.width(8.dp))
                    val canSend = input.isNotBlank() && !isTyping
                    Box(
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(if (canSend) MindexColors.Accent else Color(0x26222224))
                            .clickable(enabled = canSend) { handleSend() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = ArrowUpIcon,
                            contentDescription = "Отправить",
                            tint = Color.White,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            }
        }
    }
}

/** MediaRecorder с учётом API: с 31 конструктор требует Context. */
private fun createMediaRecorder(context: Context): MediaRecorder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        MediaRecorder(context)
    } else {
        @Suppress("DEPRECATION")
        MediaRecorder()
    }

// ─── Сообщения ───────────────────────────────────────────────────────────────

/** Пузырь пользователя — справа, rgba-подложка, «хвостик» снизу справа. */
@Composable
private fun UserMessage(message: Message) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Box(
            Modifier.fillMaxWidth(0.85f),
            contentAlignment = Alignment.TopEnd,
        ) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 4.dp, bottomStart = 18.dp))
                    .background(MindexColors.UserBubble)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                Text(
                    message.content,
                    fontFamily = Muller,
                    fontSize = 15.sp,
                    lineHeight = 22.sp,
                    color = MindexColors.TextPrimary,
                )
            }
        }
        if (message.time.isNotBlank()) {
            Text(
                message.time,
                fontFamily = Muller,
                fontSize = 11.sp,
                color = MindexColors.Text30,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 3.dp),
            )
        }
    }
}

/** Ответ Мысли — plain text слева на всю ширину + блок планирования. */
@Composable
private fun AssistantMessage(
    message: Message,
    onAnswer: (questionId: String, answer: String) -> Unit,
    onUpdateStep: (stepIndex: Int, value: String) -> Unit,
    onAccept: () -> Unit,
    onReject: () -> Unit,
) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start) {
        MarkdownText(message.content, modifier = Modifier.fillMaxWidth())
        message.planningData?.let { pd ->
            PlanningBlock(
                planningData = pd,
                onAnswer = onAnswer,
                onUpdateStep = onUpdateStep,
                onAccept = onAccept,
                onReject = onReject,
            )
        }
        if (message.time.isNotBlank()) {
            Text(
                message.time,
                fontFamily = Muller,
                fontSize = 11.sp,
                color = MindexColors.Text30,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 3.dp),
            )
        }
    }
}

/** Сменяющиеся фразы рядом с индикатором — порт ThinkingPhrase. */
@Composable
private fun ThinkingPhrase() {
    var idx by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1800)
            idx = (idx + 1) % THINKING_PHRASES.size
        }
    }
    Text(
        THINKING_PHRASES[idx],
        fontFamily = Muller,
        fontSize = 14.sp,
        fontStyle = FontStyle.Italic,
        color = Color(0x66222224),
    )
}

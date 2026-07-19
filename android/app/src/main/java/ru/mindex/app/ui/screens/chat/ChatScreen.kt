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
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
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
import ru.mindex.app.ui.screens.notes.NoteViewBody
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
    val clipboard = LocalClipboardManager.current

    val actualThreadId = rememberSaveable(threadId) {
        if (threadId == "new") UUID.randomUUID().toString() else threadId
    }

    // Снимок треда на момент открытия; дальше экран — источник правды,
    // изменения зеркалятся в репозиторий через upsertThread (как в вебе).
    val initialThread = remember(actualThreadId) {
        appViewModel.threads.value.firstOrNull { it.id == actualThreadId }
    }
    val allTasks by appViewModel.tasks.collectAsState()

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
    var noteMode by rememberSaveable { mutableStateOf(false) }
    var noteLoading by remember { mutableStateOf(false) }
    var replyQuote by remember { mutableStateOf<String?>(null) }
    var voiceState by remember { mutableStateOf(VoiceState.Idle) }
    val recorderHolder = remember { RecorderHolder() }

    // «Печатающийся» ответ — порт animatingContent из AIChat.tsx.
    var animatingText by remember { mutableStateOf<String?>(null) }
    var animSeq by remember { mutableIntStateOf(0) }
    val animTarget = remember { arrayOfNulls<String>(1) }
    LaunchedEffect(animSeq) {
        val full = animTarget[0] ?: return@LaunchedEffect
        var i = 0
        animatingText = ""
        while (i + 6 < full.length) {
            delay(10)
            i += 6
            animatingText = full.take(i)
        }
        animatingText = null
        animTarget[0] = null
    }

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
                            // Анимация «печати» финального ответа — как в вебе.
                            animTarget[0] = turn.finalMessage.content
                            animSeq++
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

                // Как в вебе: генерация плана идёт с no_tools.
                val turn = chatRepo.sendMessage(
                    messages + Message(role = "user", content = prompt, time = ft()),
                    actualThreadId,
                    noTools = true,
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

    // ─── Действия с сообщением — порт saveMessageAsNote / deleteMessage ──

    fun saveMessageAsNote(content: String) {
        val note = Thread(
            id = UUID.randomUUID().toString(),
            title = content.trim().take(40).ifBlank { "Заметка" },
            preview = content.trim().take(100),
            messages = emptyList(),
            createdAt = System.currentTimeMillis(),
            source = "заметка",
            isMeaningful = true,
            summary = content.trim(),
        )
        scope.launch { runCatching { dataRepo.upsertThread(note) } }
    }

    fun deleteMessage(msg: Message) {
        messages = messages.filterNot { it === msg }
        scope.launch { runCatching { persist() } }
    }

    // ─── Голосовой ввод — порт useVoiceInput.ts на MediaRecorder ─────────

    fun startRecording() {
        if (voiceState != VoiceState.Idle) return
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
                voiceState = VoiceState.Error
            }
        }
    }

    val micPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        // После выдачи разрешения следующее удержание микрофона начнёт запись.
        if (!granted) voiceState = VoiceState.Error
    }

    // Ошибка голосового ввода тихо гаснет через 2 секунды — как в вебе.
    LaunchedEffect(voiceState) {
        if (voiceState == VoiceState.Error) {
            delay(2000)
            voiceState = VoiceState.Idle
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

    // ─── Режим заметки: досчитать саммари, как NoteView.tsx ──────────────

    LaunchedEffect(noteMode) {
        if (noteMode && summary.isNullOrBlank() && meaningful != false &&
            messages.any { it.role == "user" || it.role == "assistant" }
        ) {
            noteLoading = true
            chatRepo.summarize(messages)?.let {
                summary = it
                meaningful = true
                runCatching { persist() }
            }
            noteLoading = false
        }
    }

    // ─── Отправка и закрытие ──────────────────────────────────────────────

    fun handleSend() {
        val text = input.trim()
        if (text.isEmpty()) return
        val quote = replyQuote
        val finalText = if (quote != null) {
            val q = if (quote.length > 100) quote.take(100) + "..." else quote
            "[Ответ на: \"$q\"]\n$text"
        } else {
            text
        }
        input = ""
        replyQuote = null
        sendText(finalText)
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
    val lastAssistantVisibleIdx = visibleMessages.indexOfLast { it.value.role == "assistant" }
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
        // ─── Шапка: назад / пилюля чат-заметка / настройки ────
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 12.dp),
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

            // Переключатель чат/заметка — белая пилюля, как в AIChat.tsx.
            Row(
                Modifier
                    .clip(CircleShape)
                    .background(Color.White)
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(if (!noteMode) Color(0x14222224) else Color.Transparent)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { noteMode = false },
                    contentAlignment = Alignment.Center,
                ) {
                    ChatTabIcon(
                        color = if (!noteMode) MindexColors.TextPrimary else Color(0x4D222224),
                        modifier = Modifier.size(19.dp),
                    )
                }
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(if (noteMode) Color(0x14222224) else Color.Transparent)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { noteMode = true },
                    contentAlignment = Alignment.Center,
                ) {
                    NoteTabIcon(
                        color = if (noteMode) MindexColors.TextPrimary else Color(0x4D222224),
                        modifier = Modifier.size(19.dp),
                    )
                }
            }

            IconButton(onClick = { navController.navigate(Routes.SETTINGS) }) {
                Icon(
                    imageVector = GearIcon,
                    contentDescription = "Настройки",
                    tint = Color(0x80222224),
                    modifier = Modifier.size(26.dp),
                )
            }
        }

        // ─── Контент: заметка или лента сообщений ─────────────
        if (noteMode) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                NoteViewBody(
                    thread = buildThread(),
                    tasks = allTasks,
                    loading = noteLoading,
                    onOpenChat = { noteMode = false },
                )
            }
        } else if (visibleMessages.isEmpty()) {
            // Пустое состояние — «Привет! Есть мысли?», как в вебе.
            Column(Modifier.weight(1f).fillMaxWidth()) {
                Column(
                    Modifier.weight(1f).fillMaxWidth().padding(horizontal = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "Привет!\nЕсть мысли?",
                        fontFamily = Muller,
                        fontSize = 28.sp,
                        lineHeight = 35.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = MindexColors.TextPrimary,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Поделись тем, что на уме",
                        fontFamily = Muller,
                        fontSize = 15.sp,
                        color = MindexColors.Text30,
                        textAlign = TextAlign.Center,
                    )
                }
                if (isTyping) {
                    Row(
                        Modifier.padding(start = 18.dp, bottom = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        MysliThinking()
                        Spacer(Modifier.width(10.dp))
                        ThinkingPhrase()
                    }
                }
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    // maskImage: растворение контента у шапки и панели ввода.
                    .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                    .drawWithContent {
                        drawContent()
                        drawRect(
                            brush = Brush.verticalGradient(
                                0f to Color.Black, 1f to Color.Transparent,
                                startY = 0f, endY = 48.dp.toPx(),
                            ),
                            blendMode = BlendMode.DstOut,
                        )
                        drawRect(
                            brush = Brush.verticalGradient(
                                0f to Color.Transparent, 1f to Color.Black,
                                startY = size.height - 80.dp.toPx(), endY = size.height,
                            ),
                            blendMode = BlendMode.DstOut,
                        )
                    },
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                items(visibleMessages.size) { i ->
                    val (origIndex, message) = visibleMessages[i]
                    if (message.role == "user") {
                        UserMessage(message)
                    } else {
                        val isLast = i == visibleMessages.size - 1
                        AssistantMessage(
                            message = message,
                            overrideText = if (isLast) animatingText else null,
                            showActions = i == lastAssistantVisibleIdx,
                            onAnswer = { qId, answer -> handleAnswer(origIndex, qId, answer) },
                            onUpdateStep = { sIdx, value -> updatePlanStep(origIndex, sIdx, value) },
                            onAccept = { handleAcceptPlan(origIndex) },
                            onReject = { handleRejectPlan(origIndex) },
                            onCopy = { clipboard.setText(AnnotatedString(message.content)) },
                            onSaveNote = { saveMessageAsNote(message.content) },
                            onReply = { replyQuote = message.content },
                            onDelete = { deleteMessage(message) },
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
                .padding(top = 16.dp, bottom = 16.dp),
        ) {
            // Цитата «Ответить» над полем ввода — как replyQuote в вебе.
            replyQuote?.let { quote ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = 6.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color(0xFFF5F5F5))
                        .padding(start = 0.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .width(2.dp)
                            .height(32.dp)
                            .background(Color(0xFFAAAAAA)),
                    )
                    Text(
                        if (quote.length > 100) quote.take(100) + "..." else quote,
                        fontFamily = Muller,
                        fontSize = 12.sp,
                        color = Color(0xFF888888),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                    Box(
                        Modifier
                            .size(28.dp)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                            ) { replyQuote = null },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = CloseIcon,
                            contentDescription = "Убрать цитату",
                            tint = Color(0xFFAAAAAA),
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
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
                    // Микрофон: удерживай для записи (мобильный веб-паттерн),
                    // idle → серый, запись → красный, обработка → спиннер.
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
                            .pointerInput(Unit) {
                                detectTapGestures(
                                    onPress = {
                                        if (voiceState == VoiceState.Idle) {
                                            val granted = ContextCompat.checkSelfPermission(
                                                context, Manifest.permission.RECORD_AUDIO,
                                            ) == PackageManager.PERMISSION_GRANTED
                                            if (!granted) {
                                                micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                            } else {
                                                startRecording()
                                                tryAwaitRelease()
                                                stopRecording()
                                            }
                                        }
                                    },
                                )
                            },
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
                                    "Отпусти, чтобы остановить"
                                } else {
                                    "Удерживай для записи"
                                },
                                tint = if (voiceState == VoiceState.Recording) Color.White else Color(0x80222224),
                                modifier = Modifier.size(15.dp),
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

/**
 * Ответ Мысли — plain text слева на всю ширину + блок планирования
 * + панель действий (копировать / «⋯»: заметка, ответить, удалить).
 * overrideText != null → идёт анимация «печати», действия скрыты.
 */
@Composable
private fun AssistantMessage(
    message: Message,
    overrideText: String?,
    showActions: Boolean,
    onAnswer: (questionId: String, answer: String) -> Unit,
    onUpdateStep: (stepIndex: Int, value: String) -> Unit,
    onAccept: () -> Unit,
    onReject: () -> Unit,
    onCopy: () -> Unit,
    onSaveNote: () -> Unit,
    onReply: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val animating = overrideText != null

    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.Start) {
        if (animating) {
            Text(
                overrideText.orEmpty(),
                fontFamily = Muller,
                fontSize = 15.sp,
                lineHeight = 26.sp,
                color = MindexColors.TextPrimary,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            MarkdownText(message.content, modifier = Modifier.fillMaxWidth())
        }
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

        // Панель действий — только у последнего ответа (как на тач-устройствах в вебе).
        if (showActions && !animating) {
            Row(
                Modifier.fillMaxWidth().padding(top = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Box(
                    Modifier
                        .size(28.dp)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = onCopy,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = CopyIcon,
                        contentDescription = "Копировать",
                        tint = Color(0xFFBBBBBB),
                        modifier = Modifier.size(14.dp),
                    )
                }

                Box {
                    Box(
                        Modifier
                            .size(28.dp)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                            ) { menuOpen = !menuOpen },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = MoreHorizontalIcon,
                            contentDescription = "Действия",
                            tint = Color(0xFFBBBBBB),
                            modifier = Modifier.size(14.dp),
                        )
                    }
                    DropdownMenu(
                        expanded = menuOpen,
                        onDismissRequest = { menuOpen = false },
                    ) {
                        DropdownMenuItem(
                            text = {
                                Text(
                                    "Сохранить как заметку",
                                    fontFamily = Muller,
                                    fontSize = 13.sp,
                                    color = Color(0xFF222222),
                                )
                            },
                            onClick = { menuOpen = false; onSaveNote() },
                        )
                        DropdownMenuItem(
                            text = {
                                Text(
                                    "Ответить",
                                    fontFamily = Muller,
                                    fontSize = 13.sp,
                                    color = Color(0xFF222222),
                                )
                            },
                            onClick = { menuOpen = false; onReply() },
                        )
                        DropdownMenuItem(
                            text = {
                                Text(
                                    "Удалить",
                                    fontFamily = Muller,
                                    fontSize = 13.sp,
                                    color = Color(0xFFE53E3E),
                                )
                            },
                            onClick = { menuOpen = false; onDelete() },
                        )
                    }
                }
            }
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

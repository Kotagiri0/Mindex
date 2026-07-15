package ru.mindex.app.ui.screens.onboarding

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.mindex.app.data.model.LocalUser
import ru.mindex.app.data.model.Message
import ru.mindex.app.data.model.Thread
import ru.mindex.app.data.model.UserSettings
import ru.mindex.app.data.repository.ChatTurn
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.RandomGrotesque
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/*
 * Онбординг — порт src/components/Onboarding.tsx 1:1.
 *
 * Два этапа:
 *  1. «Плюс» — парящий логотип Мысли, тап запускает анимацию
 *     (появляются круг и диагонали, логотип растёт и растворяется);
 *  2. «Ввод» — заголовок «Какие планы на сегодня?» и поле первой мысли
 *     (карточка как в чате: микрофон + отправка), внизу «Пропустить».
 *
 * Отправка создаёт тред из первой мысли, «Пропустить» — тред «Знакомство»
 * со скрытым промптом-знакомством; первый ответ Мысли догружается в фоне
 * (в вебе это делает автоотправка в AIChat после onComplete).
 */

// ─── Токены экрана — константы из Onboarding.tsx ────────────────────────────

private val ObBg = Color(0xFFF0F0F0)            // BG = '#f0f0f0'
private val ObFg = Color(0xFF0B0D10)            // FG = '#0B0D10'
private val HintColor = Color(0x4D0B0D10)       // rgba(11,13,16,0.3)
private val SubtitleColor = Color(0x8C222224)   // rgba(34,34,36,0.55)
private val MicIdleBg = Color(0x14222224)       // rgba(34,34,36,0.08)
private val MicProcessingBg = Color(0x26222224) // rgba(34,34,36,0.15)
private val MicIconColor = Color(0x80222224)    // rgba(34,34,36,0.5)
private val SkipColor = Color(0x66222224)       // rgba(34,34,36,0.4)
private val RecordingRed = Color(0xFFC0392B)    // '#c0392b'

private val EaseOutCubic = CubicBezierEasing(0f, 0f, 0.58f, 1f)
private val EaseInOutCubic = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
private val GrowEasing = CubicBezierEasing(0.34f, 1.2f, 0.64f, 1f)

private val InputMaxHeight = 220.dp             // MAX_HEIGHT

/** Скрытый промпт при «Пропустить» — копия из AIChat.tsx (__onboarding_skip__). */
private const val SKIP_PROMPT =
    "Представься пользователю — коротко, в своём стиле. Скажи кто ты, что умеешь " +
        "и предложи начать. Без приветственных клише, без \"Привет!\", сразу по делу."

private enum class ObStage { Plus, Animating, Input }
private enum class VoiceState { Idle, Recording, Processing }

private fun currentTime(): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())

// ─── Экран ──────────────────────────────────────────────────────────────────

@Composable
fun OnboardingScreen(appViewModel: AppViewModel, user: LocalUser) {
    var stage by remember { mutableStateOf(ObStage.Plus) }

    // Как в вебе: grow 0.9s + fadeout 0.6s = 1.5s, затем экран ввода.
    LaunchedEffect(stage) {
        if (stage == ObStage.Animating) {
            delay(1500)
            stage = ObStage.Input
        }
    }

    val slideOffsetPx = with(LocalDensity.current) { 20.dp.roundToPx() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ObBg)
            .statusBarsPadding(),
    ) {
        AnimatedContent(
            targetState = stage == ObStage.Input,
            modifier = Modifier.fillMaxSize(),
            transitionSpec = {
                // motion.div: вход fade + y:20→0 за 0.5s easeOut, выход fade 0.3s
                (fadeIn(tween(500, easing = EaseOutCubic)) +
                    slideInVertically(tween(500, easing = EaseOutCubic)) { slideOffsetPx })
                    .togetherWith(fadeOut(tween(300)))
            },
            label = "onboarding_stage",
        ) { showInput ->
            if (showInput) {
                InputStage(appViewModel = appViewModel, user = user)
            } else {
                PlusStage(
                    stage = stage,
                    onTap = { if (stage == ObStage.Plus) stage = ObStage.Animating },
                )
            }
        }
    }
}

// ─── Этап 1: парящий плюс ───────────────────────────────────────────────────

@Composable
private fun PlusStage(stage: ObStage, onTap: () -> Unit) {
    val animating = stage == ObStage.Animating

    // @keyframes ob-float: 0→-7px, 3s ease-in-out infinite
    val floatTransition = rememberInfiniteTransition(label = "ob_float")
    val floatY by floatTransition.animateFloat(
        initialValue = 0f,
        targetValue = -7f,
        animationSpec = infiniteRepeatable(
            animation = tween(1500, easing = EaseInOutCubic),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "ob_float_y",
    )

    // @keyframes ob-grow-fade: scale 1→2.2 (60% = 0.9s), затем opacity 1→0
    val logoScale by animateFloatAsState(
        targetValue = if (animating) 2.2f else 1f,
        animationSpec = tween(900, easing = GrowEasing),
        label = "ob_logo_scale",
    )
    val logoAlpha by animateFloatAsState(
        targetValue = if (animating) 0f else 1f,
        animationSpec = tween(600, delayMillis = if (animating) 900 else 0),
        label = "ob_logo_alpha",
    )
    // Круг и диагонали проявляются с задержками — как в SVG-переходах веба.
    val circleAlpha by animateFloatAsState(
        targetValue = if (animating) 1f else 0f,
        animationSpec = tween(650, delayMillis = if (animating) 200 else 0),
        label = "ob_circle_alpha",
    )
    val diag1Alpha by animateFloatAsState(
        targetValue = if (animating) 1f else 0f,
        animationSpec = tween(600, delayMillis = if (animating) 120 else 0),
        label = "ob_diag1_alpha",
    )
    val diag2Alpha by animateFloatAsState(
        targetValue = if (animating) 1f else 0f,
        animationSpec = tween(600, delayMillis = if (animating) 300 else 0),
        label = "ob_diag2_alpha",
    )
    val hintAlpha by animateFloatAsState(
        targetValue = if (animating) 0f else 1f,
        animationSpec = tween(200),
        label = "ob_hint_alpha",
    )

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .graphicsLayer {
                    translationY = if (animating) 0f else floatY.dp.toPx()
                    scaleX = logoScale
                    scaleY = logoScale
                    alpha = logoAlpha
                }
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    enabled = !animating,
                    onClick = onTap,
                ),
        ) {
            MindexLogo(
                size = 48.dp,
                circleAlpha = circleAlpha,
                diag1Alpha = diag1Alpha,
                diag2Alpha = diag2Alpha,
            )
        }
        Spacer(Modifier.height(16.dp))
        Text(
            text = "нажми, чтобы начать",
            fontFamily = Muller,
            fontSize = 13.sp,
            color = HintColor,
            modifier = Modifier.alpha(hintAlpha),
        )
    }
}

// ─── Этап 2: первая мысль ───────────────────────────────────────────────────

@Composable
private fun InputStage(appViewModel: AppViewModel, user: LocalUser) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val chatRepo = appViewModel.container.chatRepository

    var text by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var voiceState by remember { mutableStateOf(VoiceState.Idle) }
    val recorder = remember { mutableStateOf<MediaRecorder?>(null) }
    val voiceFile = remember { File(context.cacheDir, "onboarding_voice.m4a") }
    val focusRequester = remember { FocusRequester() }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* после разрешения следующее удержание микрофона начнёт запись */ }

    fun startRecording() {
        if (voiceState != VoiceState.Idle) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        runCatching {
            val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            rec.setAudioSource(MediaRecorder.AudioSource.MIC)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioEncodingBitRate(128_000)
            rec.setAudioSamplingRate(44_100)
            rec.setOutputFile(voiceFile.absolutePath)
            rec.prepare()
            rec.start()
            recorder.value = rec
            voiceState = VoiceState.Recording
        }.onFailure {
            recorder.value?.let { r -> runCatching { r.release() } }
            recorder.value = null
            voiceState = VoiceState.Idle
        }
    }

    fun stopRecording() {
        val rec = recorder.value ?: return
        recorder.value = null
        // Слишком короткая запись — stop() бросает исключение, просто сбрасываем.
        val stopped = runCatching { rec.stop() }.isSuccess
        runCatching { rec.release() }
        if (!stopped) {
            voiceState = VoiceState.Idle
            return
        }
        voiceState = VoiceState.Processing
        scope.launch {
            val transcribed = chatRepo.transcribe(voiceFile)
            voiceFile.delete()
            if (!transcribed.isNullOrBlank()) {
                // Как в вебе: prev + (prev ? ' ' : '') + transcribed
                text = if (text.isBlank()) transcribed else text + " " + transcribed
            }
            voiceState = VoiceState.Idle
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            recorder.value?.let { rec ->
                runCatching { rec.stop() }
                runCatching { rec.release() }
            }
            recorder.value = null
        }
    }

    // Автофокус — как setTimeout(100) в вебе.
    LaunchedEffect(Unit) {
        delay(100)
        runCatching { focusRequester.requestFocus() }
    }

    fun handleSubmit() {
        val content = text.trim()
        if (content.isEmpty() || loading) return
        loading = true
        val userMsg = Message(role = "user", content = content, time = currentTime())
        val thread = Thread(
            id = UUID.randomUUID().toString(),
            title = if (content.length > 40) content.take(40) + "…" else content,
            preview = content.take(100),
            messages = listOf(userMsg),
            createdAt = System.currentTimeMillis(),
        )
        finishOnboarding(
            appViewModel = appViewModel,
            user = user,
            thread = thread,
            history = listOf(userMsg),
            visibleMessages = listOf(userMsg),
        )
    }

    fun handleSkip() {
        if (loading) return
        loading = true
        val thread = Thread(
            id = UUID.randomUUID().toString(),
            title = "Знакомство",
            preview = "",
            messages = emptyList(),
            createdAt = System.currentTimeMillis(),
        )
        // Скрытый промпт: пользователь его не видит, Мысль представляется сама.
        val hiddenMsg = Message(role = "user", content = SKIP_PROMPT, time = currentTime())
        finishOnboarding(
            appViewModel = appViewModel,
            user = user,
            thread = thread,
            history = listOf(hiddenMsg),
            visibleMessages = emptyList(),
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        // ── CTA-блок ──
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        ) {
            MindexLogo(size = 48.dp)
            Text(
                text = "Какие планы\nна сегодня?",
                fontFamily = RandomGrotesque,
                fontSize = 26.sp,
                lineHeight = 31.sp,
                color = MindexColors.TextPrimary,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "Я помогу не забыть",
                fontFamily = Muller,
                fontSize = 15.sp,
                lineHeight = 23.sp,
                color = SubtitleColor,
                textAlign = TextAlign.Center,
            )
        }

        // ── Карточка ввода — как в чате ──
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MindexColors.Surface, RoundedCornerShape(20.dp))
                    .padding(16.dp),
            ) {
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = InputMaxHeight)
                        .focusRequester(focusRequester),
                    textStyle = TextStyle(
                        fontFamily = Muller,
                        fontSize = 15.sp,
                        lineHeight = 23.sp,
                        color = MindexColors.TextPrimary,
                    ),
                    cursorBrush = SolidColor(MindexColors.TextPrimary),
                    decorationBox = { innerTextField ->
                        Box {
                            if (text.isEmpty()) {
                                Text(
                                    text = "Начни первую мысль...",
                                    fontFamily = Muller,
                                    fontSize = 15.sp,
                                    lineHeight = 23.sp,
                                    color = MindexColors.Text30,
                                )
                            }
                            innerTextField()
                        }
                    },
                )

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // Микрофон — удерживай для записи (как на мобильном вебе)
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(
                                when (voiceState) {
                                    VoiceState.Recording -> RecordingRed
                                    VoiceState.Processing -> MicProcessingBg
                                    VoiceState.Idle -> MicIdleBg
                                }
                            )
                            .pointerInput(Unit) {
                                detectTapGestures(
                                    onPress = {
                                        if (voiceState == VoiceState.Idle) {
                                            startRecording()
                                            tryAwaitRelease()
                                            stopRecording()
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
                            MicIcon(
                                color = if (voiceState == VoiceState.Recording) Color.White
                                else MicIconColor,
                            )
                        }
                    }

                    // Отправка — появляется, когда есть текст
                    AnimatedVisibility(
                        visible = text.isNotBlank() && !loading,
                        enter = scaleIn() + fadeIn(),
                        exit = scaleOut() + fadeOut(),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(ObFg)
                                .clickable { handleSubmit() },
                            contentAlignment = Alignment.Center,
                        ) {
                            ArrowUpIcon(color = Color.White)
                        }
                    }
                    // Лоадер на месте кнопки отправки
                    AnimatedVisibility(
                        visible = loading,
                        enter = scaleIn() + fadeIn(),
                        exit = scaleOut() + fadeOut(),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(ObFg),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(13.dp),
                                color = Color.White,
                                trackColor = Color(0x4DFFFFFF),
                                strokeWidth = 2.dp,
                            )
                        }
                    }
                }
            }

            // ── Пропустить ──
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "Пропустить",
                    fontFamily = Muller,
                    fontSize = 14.sp,
                    color = SkipColor,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { handleSkip() }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
        }
    }
}

// ─── Завершение онбординга ──────────────────────────────────────────────────

/**
 * Сохраняет тред, отмечает онбординг пройденным и в фоне получает первый
 * ответ Мысли — веб делает то же через onComplete(threadId, initialMsg)
 * + автоотправку в AIChat. Работа идёт на viewModelScope, чтобы пережить
 * смену экрана.
 */
private fun finishOnboarding(
    appViewModel: AppViewModel,
    user: LocalUser,
    thread: Thread,
    history: List<Message>,
    visibleMessages: List<Message>,
) {
    val current = appViewModel.profile.value?.settings ?: UserSettings()
    val settings = current.copy(
        name = current.name ?: user.displayName.takeIf { it.isNotBlank() },
        email = current.email ?: user.email,
    )
    appViewModel.viewModelScope.launch {
        val data = appViewModel.container.dataRepository
        runCatching { data.upsertThread(thread) }
        appViewModel.completeOnboarding(settings)
        runCatching {
            when (val turn = appViewModel.container.chatRepository.sendMessage(history, thread.id)) {
                is ChatTurn.Answer -> data.upsertThread(
                    thread.copy(
                        messages = visibleMessages + turn.turnMessages + turn.finalMessage,
                        preview = turn.finalMessage.content.take(100),
                        updatedAt = System.currentTimeMillis(),
                    )
                )

                is ChatTurn.Planning -> data.upsertThread(
                    thread.copy(
                        messages = visibleMessages + turn.message,
                        preview = turn.message.content.take(100),
                        updatedAt = System.currentTimeMillis(),
                    )
                )
            }
        }
    }
}

// ─── Иконки (Canvas — без новых зависимостей) ───────────────────────────────

/**
 * Логотип Мысли — SVG из Onboarding.tsx (viewBox 0 0 1681 1681):
 * крест (всегда виден) + круг и диагонали с управляемой прозрачностью.
 */
@Composable
private fun MindexLogo(
    size: Dp,
    circleAlpha: Float = 1f,
    diag1Alpha: Float = 1f,
    diag2Alpha: Float = 1f,
) {
    Canvas(Modifier.size(size)) {
        val k = this.size.width / 1681f
        val sw = 117.663f * k
        val c = 840.45f * k
        // Круг
        drawCircle(
            color = ObFg,
            radius = 781.62f * k,
            center = Offset(c, c),
            alpha = circleAlpha.coerceIn(0f, 1f),
            style = Stroke(width = sw),
        )
        // Горизонталь
        drawLine(
            color = ObFg,
            start = Offset(336.19f * k, 840.43f * k),
            end = Offset(1344.73f * k, 840.43f * k),
            strokeWidth = sw,
        )
        // Вертикаль
        drawLine(
            color = ObFg,
            start = Offset(840.47f * k, 336.17f * k),
            end = Offset(840.47f * k, 1344.71f * k),
            strokeWidth = sw,
        )
        // Диагональ 1
        drawLine(
            color = ObFg,
            start = Offset(1078.16f * k, 602.73f * k),
            end = Offset(602.73f * k, 1078.16f * k),
            strokeWidth = sw,
            alpha = diag1Alpha.coerceIn(0f, 1f),
        )
        // Диагональ 2
        drawLine(
            color = ObFg,
            start = Offset(1078.16f * k, 1078.16f * k),
            end = Offset(602.73f * k, 602.73f * k),
            strokeWidth = sw,
            alpha = diag2Alpha.coerceIn(0f, 1f),
        )
    }
}

/** Микрофон — контур из inline-SVG веба (viewBox 24, stroke 1.75, round). */
@Composable
private fun MicIcon(color: Color) {
    Canvas(Modifier.size(15.dp)) {
        val k = size.width / 24f
        val sw = 1.75f * k
        // Капсула: rect x9 y2 w6 h11 rx3
        drawRoundRect(
            color = color,
            topLeft = Offset(9f * k, 2f * k),
            size = Size(6f * k, 11f * k),
            cornerRadius = CornerRadius(3f * k, 3f * k),
            style = Stroke(width = sw, cap = StrokeCap.Round),
        )
        // Дуга: M5 10c0 3.9 2.7 7 7 7s7-3.1 7-7
        val arc = Path().apply {
            moveTo(5f * k, 10f * k)
            cubicTo(5f * k, 13.9f * k, 7.7f * k, 17f * k, 12f * k, 17f * k)
            cubicTo(16.3f * k, 17f * k, 19f * k, 13.9f * k, 19f * k, 10f * k)
        }
        drawPath(arc, color = color, style = Stroke(width = sw, cap = StrokeCap.Round))
        // Ножка: line 12,19 → 12,22
        drawLine(
            color = color,
            start = Offset(12f * k, 19f * k),
            end = Offset(12f * k, 22f * k),
            strokeWidth = sw,
            cap = StrokeCap.Round,
        )
    }
}

/** Стрелка вверх — lucide ArrowUp (viewBox 24, stroke 2, round). */
@Composable
private fun ArrowUpIcon(color: Color) {
    Canvas(Modifier.size(17.dp)) {
        val k = size.width / 24f
        val sw = 2f * k
        drawLine(
            color = color,
            start = Offset(12f * k, 19f * k),
            end = Offset(12f * k, 5f * k),
            strokeWidth = sw,
            cap = StrokeCap.Round,
        )
        val chevron = Path().apply {
            moveTo(5f * k, 12f * k)
            lineTo(12f * k, 5f * k)
            lineTo(19f * k, 12f * k)
        }
        drawPath(
            path = chevron,
            color = color,
            style = Stroke(width = sw, cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}

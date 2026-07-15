package ru.mindex.app.ui.screens.notes

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import kotlinx.coroutines.launch
import ru.mindex.app.data.model.Task
import ru.mindex.app.data.model.Thread
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.components.TaskCheckMark
import ru.mindex.app.ui.navigation.Routes
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.RandomGrotesque
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

// Цвета — 1:1 с src/components/NoteView.tsx / NoteEditor.tsx
private val ViewBg = Color(0xFFF0F0F0)
private val HeaderTitleColor = Color(0xFF111111)
private val ChevronColor = Color(0xFF222224)
private val TagBg = Color(0x0F000000)             // rgba(0,0,0,0.06)
private val SaveEnabledBg = Color(0xFF0B0D10)
private val SaveDisabledBg = Color(0x14222224)    // rgba(34,34,36,0.08)
private val SaveDisabledText = Color(0x4D222224)  // rgba(34,34,36,0.3)
private val PlaceholderColor = Color(0x4D222224)
private val OpenChatBorder = Color(0x1F000000)    // rgba(0,0,0,0.12)
private val DeleteRed = Color(0xFFE53E3E)

/** Дата — как toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }). */
private val NoteDateFormat = DateTimeFormatter.ofPattern("d MMMM yyyy 'г.'", Locale("ru"))

/**
 * Экран заметки — порт src/components/NoteView.tsx + NoteEditor.tsx.
 *
 * Ручные заметки (source == "заметка") и новые (noteId == "new")
 * открываются в редакторе; остальные треды-заметки — в режиме просмотра
 * с саммари, задачами из мысли и переходом в диалог.
 *
 * Сохранение и удаление идут теми же путями, что инструменты Мысли
 * save_as_note / delete_note: DataRepository.upsertThread / deleteThread.
 */
@Composable
fun NoteScreen(appViewModel: AppViewModel, navController: NavHostController, noteId: String) {
    val threads by appViewModel.threads.collectAsState()
    val tasks by appViewModel.tasks.collectAsState()
    val thread = threads.firstOrNull { it.id == noteId }

    if (thread == null || thread.source == "заметка") {
        NoteEditorContent(
            thread = thread,
            noteId = noteId,
            appViewModel = appViewModel,
            navController = navController,
        )
    } else {
        NoteViewContent(
            thread = thread,
            tasks = tasks,
            navController = navController,
        )
    }
}

// ─── Редактор заметки (порт NoteEditor.tsx) ─────────────────────────────────

@Composable
private fun NoteEditorContent(
    thread: Thread?,
    noteId: String,
    appViewModel: AppViewModel,
    navController: NavHostController,
) {
    val scope = rememberCoroutineScope()
    val repo = appViewModel.container.dataRepository

    val resolvedId = remember(noteId) {
        if (noteId == "new" || noteId.isBlank()) UUID.randomUUID().toString() else noteId
    }
    var title by rememberSaveable(resolvedId) {
        mutableStateOf(if (thread?.title == "Новая мысль") "" else thread?.title.orEmpty())
    }
    var content by rememberSaveable(resolvedId) {
        mutableStateOf(thread?.messages?.firstOrNull()?.content ?: thread?.summary.orEmpty())
    }
    var saving by remember { mutableStateOf(false) }

    val contentFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { contentFocus.requestFocus() }

    val canSave = content.trim().isNotEmpty()

    fun handleSave() {
        if (!canSave || saving) return
        saving = true
        val trimmed = content.trim()
        val resolvedTitle = title.trim().ifEmpty { trimmed.take(40) }.ifBlank { "Заметка" }
        // Та же модель, что собирают NoteEditor.tsx и инструмент save_as_note.
        val saved = Thread(
            id = resolvedId,
            title = resolvedTitle,
            preview = trimmed.take(100),
            messages = emptyList(),
            createdAt = thread?.createdAt ?: System.currentTimeMillis(),
            source = "заметка",
            isMeaningful = true,
            summary = trimmed,
        )
        scope.launch {
            repo.upsertThread(saved)
            navController.popBackStack()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.White)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        // ─── Шапка: назад, удалить (для существующей), сохранить ─
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            BackButton(onClick = { navController.popBackStack() })

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (thread != null) {
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                            ) {
                                scope.launch {
                                    repo.deleteThread(resolvedId)
                                    navController.popBackStack()
                                }
                            }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        Text(
                            text = "Удалить",
                            style = TextStyle(
                                fontFamily = Muller,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                                color = DeleteRed,
                            ),
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(if (canSave) SaveEnabledBg else SaveDisabledBg)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            enabled = canSave && !saving,
                        ) { handleSave() }
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = if (saving) "Сохранение..." else "Сохранить",
                        style = TextStyle(
                            fontFamily = Muller,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            color = if (canSave) Color.White else SaveDisabledText,
                        ),
                    )
                }
            }
        }

        // ─── Заголовок ───────────────────────────────────────────
        BasicTextField(
            value = title,
            onValueChange = { title = it },
            singleLine = true,
            textStyle = TextStyle(
                fontFamily = RandomGrotesque,
                fontSize = 24.sp,
                color = Color(0xFF222224),
            ),
            cursorBrush = SolidColor(Color(0xFF222224)),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            keyboardActions = KeyboardActions(onNext = { contentFocus.requestFocus() }),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, top = 4.dp),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (title.isEmpty()) {
                        Text(
                            text = "Заголовок",
                            style = TextStyle(
                                fontFamily = RandomGrotesque,
                                fontSize = 24.sp,
                                color = PlaceholderColor,
                            ),
                        )
                    }
                    inner()
                }
            },
        )

        // ─── Текст заметки ───────────────────────────────────────
        BasicTextField(
            value = content,
            onValueChange = { content = it },
            textStyle = TextStyle(
                fontFamily = Muller,
                fontSize = 15.sp,
                lineHeight = 26.sp,
                color = Color(0xFF222224),
            ),
            cursorBrush = SolidColor(Color(0xFF222224)),
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, top = 10.dp, bottom = 16.dp)
                .focusRequester(contentFocus),
            decorationBox = { inner ->
                Box {
                    if (content.isEmpty()) {
                        Text(
                            text = "Напиши что угодно...",
                            style = TextStyle(
                                fontFamily = Muller,
                                fontSize = 15.sp,
                                lineHeight = 26.sp,
                                color = PlaceholderColor,
                            ),
                        )
                    }
                    inner()
                }
            },
        )
    }
}

// ─── Просмотр заметки (порт NoteView.tsx) ───────────────────────────────────

@Composable
private fun NoteViewContent(
    thread: Thread,
    tasks: List<Task>,
    navController: NavHostController,
) {
    val threadTasks = remember(tasks, thread.id) { tasks.filter { it.threadId == thread.id } }
    val dateStr = remember(thread.createdAt) {
        Instant.ofEpochMilli(thread.createdAt)
            .atZone(ZoneId.systemDefault())
            .toLocalDate()
            .format(NoteDateFormat)
    }
    val sourceTag = when (thread.source) {
        "text" -> "Текст"
        "заметка" -> "Заметка"
        "skill" -> "Скилл"
        else -> "Мысль"
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(ViewBg)
            .statusBarsPadding(),
    ) {
        // ─── Шапка: назад / «Заметка» ────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            BackButton(onClick = { navController.popBackStack() })
            Text(
                text = "Заметка",
                style = TextStyle(
                    fontFamily = Muller,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = HeaderTitleColor,
                ),
            )
            Spacer(modifier = Modifier.width(44.dp))
        }

        // ─── Белая панель с контентом ────────────────────────────
        Column(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                .background(Color.White),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(start = 24.dp, end = 24.dp, top = 48.dp, bottom = 60.dp),
            ) {
                // Тег источника + дата
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.padding(bottom = 16.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(TagBg)
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            text = sourceTag.uppercase(Locale("ru")),
                            style = TextStyle(
                                fontFamily = Muller,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = 0.9.sp,
                                color = MindexColors.TextMuted,
                            ),
                        )
                    }
                    Text(
                        text = dateStr,
                        style = TextStyle(
                            fontFamily = Muller,
                            fontSize = 13.sp,
                            color = MindexColors.Text30,
                        ),
                    )
                }

                // Заголовок
                Text(
                    text = thread.title,
                    style = TextStyle(
                        fontFamily = RandomGrotesque,
                        fontSize = 32.sp,
                        lineHeight = 37.sp,
                        color = MindexColors.Text80,
                    ),
                    modifier = Modifier.padding(bottom = 32.dp),
                )

                // ─── Саммари ─────────────────────────────────────
                SectionLabel("Саммари")
                when {
                    thread.isMeaningful == false -> Text(
                        text = "Эта мысль не попала в архив — слишком короткая или операционная.",
                        style = TextStyle(
                            fontFamily = Muller,
                            fontSize = 14.sp,
                            fontStyle = FontStyle.Italic,
                            color = MindexColors.Text30,
                        ),
                    )

                    !thread.summary.isNullOrBlank() -> MarkdownText(thread.summary.orEmpty())

                    else -> Text(
                        text = "Нет сообщений для саммари.",
                        style = TextStyle(
                            fontFamily = Muller,
                            fontSize = 15.sp,
                            color = MindexColors.Text80,
                        ),
                    )
                }
                Spacer(modifier = Modifier.height(36.dp))

                // ─── Задачи из этой мысли ────────────────────────
                if (threadTasks.isNotEmpty()) {
                    SectionLabel("Задачи из этой мысли")
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(MindexColors.Surface)
                            .border(1.dp, MindexColors.Border, RoundedCornerShape(16.dp)),
                    ) {
                        threadTasks.forEachIndexed { idx, task ->
                            NoteTaskRow(task)
                            if (idx < threadTasks.size - 1) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(1.dp)
                                        .background(MindexColors.Border),
                                )
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(36.dp))
                }

                // ─── Сохранённый текст (для source == "text") ────
                if (thread.source == "text" && thread.messages.isNotEmpty()) {
                    SectionLabel("Сохранённый текст")
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(MindexColors.Surface)
                            .border(1.dp, MindexColors.Border, RoundedCornerShape(16.dp))
                            .padding(horizontal = 20.dp, vertical = 16.dp),
                    ) {
                        Text(
                            text = thread.messages.first().content,
                            style = TextStyle(
                                fontFamily = Muller,
                                fontSize = 15.sp,
                                lineHeight = 26.sp,
                                color = MindexColors.Text80,
                            ),
                        )
                    }
                    Spacer(modifier = Modifier.height(36.dp))
                }

                // ─── «Открыть диалог» ────────────────────────────
                if (thread.source != "text") {
                    Row(
                        modifier = Modifier
                            .clip(CircleShape)
                            .border(1.dp, OpenChatBorder, CircleShape)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                            ) { navController.navigate(Routes.chat(thread.id)) }
                            .padding(horizontal = 20.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ChatBubbleIcon(
                            color = MindexColors.TextPrimary,
                            modifier = Modifier.size(15.dp),
                        )
                        Text(
                            text = "Открыть диалог",
                            style = TextStyle(
                                fontFamily = Muller,
                                fontSize = 14.sp,
                                color = MindexColors.TextPrimary,
                            ),
                        )
                    }
                }
            }
        }
    }
}

/** Строка задачи в карточке «Задачи из этой мысли» — только отображение. */
@Composable
private fun NoteTaskRow(task: Task) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(18.dp)
                .clip(CircleShape)
                .background(if (task.done) MindexColors.TextPrimary else Color.Transparent)
                .border(
                    width = 1.5.dp,
                    color = if (task.done) MindexColors.TextPrimary else MindexColors.Text30,
                    shape = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (task.done) {
                TaskCheckMark(color = Color.White, modifier = Modifier.size(9.dp))
            }
        }
        Text(
            text = task.name,
            style = TextStyle(
                fontFamily = Muller,
                fontSize = 14.sp,
                color = if (task.done) MindexColors.Text30 else MindexColors.TextPrimary,
                textDecoration = if (task.done) TextDecoration.LineThrough else TextDecoration.None,
            ),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (task.time.isNotEmpty()) {
            Text(
                text = task.time,
                style = TextStyle(
                    fontFamily = Muller,
                    fontSize = 13.sp,
                    color = MindexColors.Text30,
                ),
            )
        }
    }
}

/** Ярлык секции — Muller 12 SemiBold uppercase, как в NoteView.tsx. */
@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(Locale("ru")),
        style = TextStyle(
            fontFamily = Muller,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.sp,
            color = MindexColors.Text30,
        ),
        modifier = Modifier.padding(bottom = 14.dp),
    )
}

// ─── Упрощённый markdown (порт renderMarkdown из NoteView.tsx) ──────────────

/** Абзацы, списки «- … / – …» и жирный **текст** — как в вебе. */
@Composable
private fun MarkdownText(text: String) {
    val listItemRegex = remember { Regex("^[-–—•]\\s") }
    Column {
        text.trim().split(Regex("\n\n+")).forEach { para ->
            val lines = para.split("\n")
            val isList = lines.all { it.isBlank() || listItemRegex.containsMatchIn(it.trim()) }
            if (isList) {
                Column(
                    modifier = Modifier.padding(bottom = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    lines.filter { it.isNotBlank() }.forEach { line ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                text = "–",
                                style = TextStyle(
                                    fontFamily = Muller,
                                    fontSize = 15.sp,
                                    color = MindexColors.Text30,
                                ),
                            )
                            Text(
                                text = inlineBold(line.trim().replace(Regex("^[-–—•]\\s*"), "")),
                                style = TextStyle(
                                    fontFamily = Muller,
                                    fontSize = 15.sp,
                                    lineHeight = 22.sp,
                                    color = MindexColors.Text80,
                                ),
                            )
                        }
                    }
                }
            } else {
                Text(
                    text = inlineBold(para),
                    style = TextStyle(
                        fontFamily = Muller,
                        fontSize = 15.sp,
                        lineHeight = 26.sp,
                        color = MindexColors.Text80,
                    ),
                    modifier = Modifier.padding(bottom = 12.dp),
                )
            }
        }
    }
}

/** **жирный** → SemiBold основным цветом текста. */
private fun inlineBold(text: String): AnnotatedString = buildAnnotatedString {
    var index = 0
    val regex = Regex("\\*\\*([^*]+)\\*\\*")
    for (match in regex.findAll(text)) {
        append(text.substring(index, match.range.first))
        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = MindexColors.TextPrimary)) {
            append(match.groupValues[1])
        }
        index = match.range.last + 1
    }
    if (index < text.length) append(text.substring(index))
}

// ─── Мелкие детали ──────────────────────────────────────────────────────────

/** Кнопка «назад» — тап-зона 44dp с шевроном влево. */
@Composable
private fun BackButton(onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(44.dp)
            .clip(CircleShape)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.size(22.dp)) {
            val stroke = Stroke(width = size.width * 0.09f, cap = StrokeCap.Round, join = StrokeJoin.Round)
            drawPath(
                path = Path().apply {
                    moveTo(size.width * 0.6f, size.height * 0.25f)
                    lineTo(size.width * 0.38f, size.height * 0.5f)
                    lineTo(size.width * 0.6f, size.height * 0.75f)
                },
                color = ChevronColor,
                style = stroke,
            )
        }
    }
}

/** Пузырь диалога (outline) — аналог lucide MessageCircle. */
@Composable
private fun ChatBubbleIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = size.width * 0.1f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val path = Path().apply {
            // Круг с разрывом в нижнем левом углу и «хвостиком»
            addArc(
                oval = Rect(
                    Offset(size.width * 0.1f, size.height * 0.1f),
                    Offset(size.width * 0.9f, size.height * 0.9f),
                ),
                startAngleDegrees = 160f,
                sweepAngleDegrees = 330f,
            )
            lineTo(size.width * 0.12f, size.height * 0.88f)
        }
        drawPath(path = path, color = color, style = stroke)
    }
}

package ru.mindex.app.ui.screens.chat

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.mindex.app.data.model.PlanningData
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.Muller

// ─── Иконки чата (стандартные материальные пути, 24×24) ─────────────────────

private fun chatIcon(name: String, vararg paths: String): ImageVector {
    val builder = ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    )
    paths.forEach { builder.addPath(pathData = addPathNodes(it), fill = SolidColor(Color.Black)) }
    return builder.build()
}

/** Шеврон «назад» — аналог ChevronLeft из lucide в шапке AIChat.tsx. */
internal val ChevronLeftIcon: ImageVector = chatIcon(
    "ChatChevronLeft",
    "M15.41,7.41L14,6l-6,6l6,6l1.41,-1.41L10.83,12z",
)

/** Стрелка вверх — кнопка отправки (ArrowUp). */
internal val ArrowUpIcon: ImageVector = chatIcon(
    "ChatArrowUp",
    "M4,12l1.41,1.41L11,7.83V20h2V7.83l5.58,5.59L20,12l-8,-8L4,12z",
)

/** Микрофон — голосовой ввод (Mic). */
internal val MicIcon: ImageVector = chatIcon(
    "ChatMic",
    "M12,14c1.66,0 3,-1.34 3,-3V5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6C9,12.66 10.34,14 12,14z",
    "M17,11c0,2.76 -2.24,5 -5,5s-5,-2.24 -5,-5H5c0,3.53 2.61,6.43 6,6.92V21h2v-3.08c3.39,-0.49 6,-3.39 6,-6.92H17z",
)

/** Звёздочка — заголовок карточки плана (Star, filled). */
internal val StarIcon: ImageVector = chatIcon(
    "ChatStar",
    "M12,17.27L18.18,21l-1.64,-7.03L22,9.24l-7.19,-0.61L12,2L9.19,8.63L2,9.24l5.46,4.73L5.82,21L12,17.27z",
)

/** Копировать — панель действий под ответом Мысли (lucide Copy). */
internal val CopyIcon: ImageVector = chatIcon(
    "ChatCopy",
    "M16,1L4,1C2.9,1 2,1.9 2,3v14h2L4,3h12V1zM19,5L8,5C6.9,5 6,5.9 6,7v14c0,1.1 0.9,2 2,2h11c1.1,0 2,-0.9 2,-2L21,7c0,-1.1 -0.9,-2 -2,-2zM19,21L8,21L8,7h11v14z",
)

/** «⋯» — меню действий сообщения (lucide MoreHorizontal). */
internal val MoreHorizontalIcon: ImageVector = chatIcon(
    "ChatMoreHorizontal",
    "M6,10c-1.1,0 -2,0.9 -2,2s0.9,2 2,2s2,-0.9 2,-2s-0.9,-2 -2,-2zM18,10c-1.1,0 -2,0.9 -2,2s0.9,2 2,2s2,-0.9 2,-2s-0.9,-2 -2,-2zM12,10c-1.1,0 -2,0.9 -2,2s0.9,2 2,2s2,-0.9 2,-2s-0.9,-2 -2,-2z",
)

/** Крестик — закрыть цитату ответа (lucide X). */
internal val CloseIcon: ImageVector = chatIcon(
    "ChatClose",
    "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12z",
)

/** Шестерёнка — переход в настройки из шапки чата. */
internal val GearIcon: ImageVector = chatIcon(
    "ChatGear",
    "M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z",
)

// ─── Иконки переключателя чат/заметка (порт ChatIcon/NoteIcon из icons) ─────

/** Круглый чат-пузырь с «хвостиком» — режим чата в пилюле шапки. */
@Composable
internal fun ChatTabIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = this.size.width
        val h = this.size.height
        val stroke = Stroke(width = w * 0.1f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val path = Path().apply {
            addArc(
                oval = Rect(Offset(w * 0.1f, h * 0.1f), Offset(w * 0.9f, h * 0.9f)),
                startAngleDegrees = 160f,
                sweepAngleDegrees = 330f,
            )
            lineTo(w * 0.12f, h * 0.88f)
        }
        drawPath(path = path, color = color, style = stroke)
    }
}

/** Квадратный пузырь с загибом угла — режим заметки в пилюле шапки. */
@Composable
internal fun NoteTabIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = this.size.width
        val h = this.size.height
        val stroke = Stroke(width = w * 0.1f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        // Скруглённый квадрат
        drawRoundRect(
            color = color,
            topLeft = Offset(w * 0.08f, h * 0.08f),
            size = androidx.compose.ui.geometry.Size(w * 0.84f, h * 0.84f),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(w * 0.3f, h * 0.3f),
            style = stroke,
        )
        // Загиб нижнего правого угла
        val fold = Path().apply {
            moveTo(w * 0.57f, h * 0.9f)
            lineTo(w * 0.57f, h * 0.68f)
            quadraticBezierTo(w * 0.57f, h * 0.56f, w * 0.69f, h * 0.56f)
            lineTo(w * 0.9f, h * 0.56f)
        }
        drawPath(path = fold, color = color, style = stroke)
    }
}

// ─── Markdown ────────────────────────────────────────────────────────────────

/**
 * Инлайн-разметка ответа Мысли — порт parseInline() из AIChat.tsx:
 * **жирный**, *курсив*, `код`.
 */
internal fun parseInlineMarkdown(line: String): AnnotatedString = buildAnnotatedString {
    val re = Regex("(\\*\\*(.+?)\\*\\*|\\*(.+?)\\*|`(.+?)`)")
    var last = 0
    for (match in re.findAll(line)) {
        if (match.range.first > last) append(line.substring(last, match.range.first))
        val bold = match.groupValues[2]
        val italic = match.groupValues[3]
        val code = match.groupValues[4]
        when {
            bold.isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(bold) }
            italic.isNotEmpty() -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(italic) }
            code.isNotEmpty() -> withStyle(
                SpanStyle(
                    fontFamily = FontFamily.Monospace,
                    background = Color(0x12000000),
                    fontSize = 13.5.sp,
                ),
            ) { append(code) }
        }
        last = match.range.last + 1
    }
    if (last < line.length) append(line.substring(last))
}

/**
 * Лёгкий рендер markdown ответа ассистента — порт renderMarkdown()
 * из AIChat.tsx: нумерованные и маркированные списки + инлайн-стили.
 */
@Composable
internal fun MarkdownText(text: String, modifier: Modifier = Modifier) {
    val bodyStyle = TextStyle(
        fontFamily = Muller,
        fontSize = 15.sp,
        lineHeight = 26.sp,
        color = MindexColors.TextPrimary,
    )
    val numRe = remember { Regex("^(\\d+)\\.\\s+(.*)$") }
    val bulletRe = remember { Regex("^[-•]\\s+(.*)$") }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        text.split("\n").forEach { line ->
            val nm = numRe.find(line)
            val bm = bulletRe.find(line)
            when {
                nm != null -> Row(Modifier.padding(start = 8.dp)) {
                    Text("${nm.groupValues[1]}.", style = bodyStyle)
                    Spacer(Modifier.width(6.dp))
                    Text(parseInlineMarkdown(nm.groupValues[2]), style = bodyStyle)
                }

                bm != null -> Row(Modifier.padding(start = 8.dp)) {
                    Text("•", style = bodyStyle)
                    Spacer(Modifier.width(6.dp))
                    Text(parseInlineMarkdown(bm.groupValues[1]), style = bodyStyle)
                }

                line.isEmpty() -> Spacer(Modifier.height(6.dp))

                else -> Text(parseInlineMarkdown(line), style = bodyStyle)
            }
        }
    }
}

// ─── Блок планирования ───────────────────────────────────────────────────────

/**
 * Вопросник и карточка плана — порт planning_data-блока из AIChat.tsx.
 *
 * status == "questionnaire": вопросы с вариантами-чипами и полем
 * «Свой вариант...»; отвеченные вопросы сворачиваются в карточку.
 * status == "plan_generated": карточка плана с редактируемыми шагами
 * и кнопками «Принять» / «Отмена».
 */
@Composable
internal fun PlanningBlock(
    planningData: PlanningData,
    onAnswer: (questionId: String, answer: String) -> Unit,
    onUpdateStep: (stepIndex: Int, value: String) -> Unit,
    onAccept: () -> Unit,
    onReject: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (planningData.status == "questionnaire") {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                planningData.questions.forEach { q ->
                    val answered = planningData.answers?.get(q.id)
                    if (answered != null) {
                        // Отвеченный вопрос — компактная карточка.
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(MindexColors.Surface.copy(alpha = 0.8f))
                                .border(1.dp, MindexColors.Border, RoundedCornerShape(8.dp))
                                .padding(8.dp),
                        ) {
                            Text(
                                q.question,
                                fontFamily = Muller,
                                fontSize = 11.sp,
                                color = MindexColors.Text40,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                answered,
                                fontFamily = Muller,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = MindexColors.TextPrimary,
                            )
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                q.question,
                                fontFamily = Muller,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                color = MindexColors.TextPrimary,
                            )
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                q.options.forEach { opt ->
                                    Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(12.dp))
                                            .background(MindexColors.Surface)
                                            .border(1.dp, MindexColors.Border, RoundedCornerShape(12.dp))
                                            .clickable { onAnswer(q.id, opt) }
                                            .padding(8.dp),
                                    ) {
                                        Text(
                                            opt,
                                            fontFamily = Muller,
                                            fontSize = 13.sp,
                                            color = MindexColors.TextPrimary,
                                        )
                                    }
                                }
                                CustomAnswerField(questionId = q.id, onSubmit = { onAnswer(q.id, it) })
                            }
                        }
                    }
                }
            }
        }

        val plan = planningData.plan
        if (planningData.status == "plan_generated" && plan != null) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(MindexColors.Surface)
                    .border(1.dp, MindexColors.Border, RoundedCornerShape(16.dp))
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        imageVector = StarIcon,
                        contentDescription = null,
                        tint = MindexColors.Accent,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        plan.title,
                        fontFamily = Muller,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = MindexColors.Accent,
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    plan.steps.forEachIndexed { sIdx, step ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Box(
                                Modifier
                                    .size(20.dp)
                                    .clip(CircleShape)
                                    // bg-accent/10 — rgba(34,34,36,0.1), как в вебе
                                    .background(Color(0x1A222224)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    "${sIdx + 1}",
                                    fontFamily = Muller,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MindexColors.Accent,
                                )
                            }
                            BasicTextField(
                                value = step,
                                onValueChange = { onUpdateStep(sIdx, it) },
                                textStyle = TextStyle(
                                    fontFamily = Muller,
                                    fontSize = 13.sp,
                                    color = MindexColors.TextPrimary,
                                ),
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }

                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(
                        Modifier
                            .weight(1f)
                            .height(40.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(MindexColors.Accent)
                            .clickable(onClick = onAccept),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Принять",
                            fontFamily = Muller,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        )
                    }
                    Box(
                        Modifier
                            .weight(1f)
                            .height(40.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(MindexColors.Surface2)
                            .clickable(onClick = onReject),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "Отмена",
                            fontFamily = Muller,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = MindexColors.TextPrimary,
                        )
                    }
                }
            }
        }
    }
}

/** Поле «Свой вариант...» под вариантами ответа — Enter/Done отправляет. */
@Composable
private fun CustomAnswerField(questionId: String, onSubmit: (String) -> Unit) {
    var value by rememberSaveable(questionId) { mutableStateOf("") }
    BasicTextField(
        value = value,
        onValueChange = { value = it },
        singleLine = true,
        textStyle = TextStyle(
            fontFamily = Muller,
            fontSize = 13.sp,
            color = MindexColors.TextPrimary,
        ),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = {
            val text = value.trim()
            if (text.isNotEmpty()) onSubmit(text)
        }),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MindexColors.Surface)
            .border(1.dp, MindexColors.Border, RoundedCornerShape(12.dp))
            .padding(8.dp),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) {
                    Text(
                        "Свой вариант...",
                        fontFamily = Muller,
                        fontSize = 13.sp,
                        color = MindexColors.Text30,
                    )
                }
                inner()
            }
        },
    )
}

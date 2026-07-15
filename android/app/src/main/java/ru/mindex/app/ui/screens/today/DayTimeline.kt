package ru.mindex.app.ui.screens.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import ru.mindex.app.data.model.Task
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.TaskCategoryPalette
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale
import kotlin.math.roundToInt

/*
 * Таймлайн дня — порт src/components/DayTimeline.tsx + src/lib/timeline.ts.
 *
 * Часовая сетка 0–24, блоки задач по времени (time → endTime) в пастельных
 * цветах категорий, тонкие серые чипы задач без времени (слот прикинут
 * автоматически), едущая красная линия текущего времени.
 * Перетаскивание блока (long-press) двигает время с шагом 5 минут.
 */

// Размеры — 1:1 с константами DayTimeline.tsx (px → dp).
private val HOUR_H = 88.dp        // высота одного часа
private val GUTTER = 48.dp        // левая колонка с подписями часов
private val RIGHT_PAD = 16.dp     // отступ блоков от правого края
private val COL_GAP = 6.dp        // зазор между колонками наложения
private val BLOCK_RADIUS = 18.dp  // радиус блока
private const val SNAP_MIN = 5    // шаг привязки при перетаскивании, минут

// Раскладка — 1:1 с src/lib/timeline.ts.
private const val DEFAULT_DURATION_MIN = 60
private const val UNTIMED_SLOT_MIN = 30
private const val WORK_START_MIN = 8 * 60
private const val WORK_END_MIN = 23 * 60

// Цвета — 1:1 с DayTimeline.tsx.
private val HourLineColor = Color(0x12222224)      // rgba(34,34,36,0.07)
private val HourLabelColor = Color(0x59222224)     // rgba(34,34,36,0.35)
private val UntimedBg = Color(0xFFEFEFF0)
private val UntimedText = Color(0xB3222224)        // rgba(34,34,36,0.7)
private val NowLineColor = Color(0xFFFF3B30)

// ─── Математика раскладки (порт src/lib/timeline.ts) ────────────────────────

/** "HH:MM" → минуты от полуночи. Невалидно → null. */
internal fun parseTime(value: String?): Int? {
    if (value.isNullOrBlank()) return null
    val m = Regex("^(\\d{1,2}):(\\d{2})$").find(value.trim()) ?: return null
    val h = m.groupValues[1].toInt()
    val min = m.groupValues[2].toInt()
    if (h > 23 || min > 59) return null
    return h * 60 + min
}

/** Минуты от полуночи → "HH:MM" (обрезается в [0, 24*60)). */
internal fun formatTime(minutes: Int): String {
    val clamped = minutes.coerceIn(0, 24 * 60 - 1)
    return String.format(Locale.US, "%02d:%02d", clamped / 60, clamped % 60)
}

/** Задача, размещённая на таймлайне. */
internal data class PlacedTask(
    val task: Task,
    /** Минуты от полуночи — начало. */
    val startMin: Int,
    /** Минуты от полуночи — конец (start + длительность, минимум +15). */
    val endMin: Int,
    /** Колонка для разрешения наложений (0..cols-1). */
    val col: Int,
    /** Сколько всего колонок в кластере наложения этой задачи. */
    val cols: Int,
    /** true — задача без времени, слот прикинут автоматически (тонкий серый чип). */
    val untimed: Boolean = false,
)

private data class RawPlaced(
    val task: Task,
    val startMin: Int,
    val endMin: Int,
    val untimed: Boolean = false,
)

/** Назначает колонки внутри кластеров пересечений (жадно). */
private fun assignColumns(raw: List<RawPlaced>): List<PlacedTask> {
    val sorted = raw.sortedWith(compareBy({ it.startMin }, { it.endMin }))
    val placed = mutableListOf<PlacedTask>()
    val cluster = mutableListOf<Pair<RawPlaced, Int>>()
    val colEnds = mutableListOf<Int>()
    var clusterEnd = -1

    fun flush() {
        if (cluster.isEmpty()) return
        val cols = colEnds.size
        cluster.forEach { (item, col) ->
            placed.add(PlacedTask(item.task, item.startMin, item.endMin, col, cols, item.untimed))
        }
        cluster.clear()
        colEnds.clear()
        clusterEnd = -1
    }

    for (item in sorted) {
        if (cluster.isNotEmpty() && item.startMin >= clusterEnd) flush()
        var col = colEnds.indexOfFirst { it <= item.startMin }
        if (col == -1) {
            col = colEnds.size
            colEnds.add(item.endMin)
        } else {
            colEnds[col] = item.endMin
        }
        cluster.add(item to col)
        clusterEnd = maxOf(clusterEnd, item.endMin)
    }
    flush()
    return placed
}

/**
 * Ищет первое свободное окно длиной UNTIMED_SLOT_MIN в рабочем окне дня,
 * начиная с max(fromMin, WORK_START). Ночью слоты не выдаём.
 */
private fun findFreeSlot(busy: List<IntRange>, fromMin: Int): Int {
    val sorted = busy.sortedBy { it.first }
    var cursor = maxOf(WORK_START_MIN, fromMin)
    for (b in sorted) {
        if (b.last <= cursor) continue
        if (b.first - cursor >= UNTIMED_SLOT_MIN) return cursor
        cursor = maxOf(cursor, b.last)
    }
    if (cursor + UNTIMED_SLOT_MIN <= WORK_END_MIN) return cursor
    return maxOf(WORK_START_MIN, WORK_END_MIN - UNTIMED_SLOT_MIN)
}

/**
 * Раскладывает задачи дня на таймлайн — порт layoutDay из src/lib/timeline.ts:
 *  - задачи со временем — как есть, с разрешением наложений;
 *  - задачи с suggestedTime — на предложенный агентом слот (тонкий чип);
 *  - остальные без времени — в первое свободное дневное окно от `nowMin`.
 */
internal fun layoutDay(tasks: List<Task>, nowMin: Int): List<PlacedTask> {
    val timedRaw = mutableListOf<RawPlaced>()
    val untimedTasks = mutableListOf<Task>()

    for (task in tasks) {
        val startMin = parseTime(task.time)
        if (startMin == null) {
            untimedTasks.add(task)
            continue
        }
        val endParsed = parseTime(task.endTime)
        val endMin =
            if (endParsed != null && endParsed > startMin) endParsed
            else minOf(24 * 60, startMin + DEFAULT_DURATION_MIN)
        timedRaw.add(RawPlaced(task, startMin, maxOf(endMin, startMin + 15)))
    }

    val busy = timedRaw.map { it.startMin..it.endMin }.toMutableList()
    val untimedRaw = mutableListOf<RawPlaced>()

    // 1) Задачи с suggestedTime — ставим на предложенный агентом слот напрямую.
    val fallbackTasks = mutableListOf<Task>()
    for (task in untimedTasks) {
        val s = parseTime(task.suggestedTime)
        if (s == null) {
            fallbackTasks.add(task)
            continue
        }
        val e = parseTime(task.suggestedEndTime)
        val endMin = if (e != null && e > s) e else s + UNTIMED_SLOT_MIN
        untimedRaw.add(RawPlaced(task, s, endMin, untimed = true))
        busy.add(s..endMin)
    }

    // 2) Остальные — первое свободное дневное окно от текущего времени, по 2 в ряд.
    val from = maxOf(WORK_START_MIN, minOf(nowMin, WORK_END_MIN - UNTIMED_SLOT_MIN))
    val perRow = 2
    if (fallbackTasks.isNotEmpty()) {
        var slotStart = findFreeSlot(busy, from)
        var inRow = 0
        for (task in fallbackTasks) {
            if (inRow >= perRow) {
                busy.add(slotStart..(slotStart + UNTIMED_SLOT_MIN))
                slotStart = findFreeSlot(busy, slotStart + UNTIMED_SLOT_MIN)
                inRow = 0
            }
            untimedRaw.add(RawPlaced(task, slotStart, slotStart + UNTIMED_SLOT_MIN, untimed = true))
            inRow++
        }
    }

    return assignColumns(timedRaw + untimedRaw)
}

// ─── Composable ─────────────────────────────────────────────────────────────

private fun nowMinutes(): Int {
    val t = LocalTime.now()
    return t.hour * 60 + t.minute
}

/**
 * Таймлайн одного дня.
 *
 * @param onTaskClick тап по блоку со временем — открыть детали.
 * @param onCreateAt тап по пустому месту — создать задачу на этом времени ("HH:MM").
 * @param onUntimedClick тап по чипу задачи без времени.
 * @param onTaskMove перетаскивание блока: новое время начала/конца ("HH:MM").
 */
@Composable
internal fun DayTimeline(
    date: String,
    tasks: List<Task>,
    onTaskClick: (Task) -> Unit,
    onCreateAt: (String) -> Unit,
    onUntimedClick: (Task) -> Unit,
    onTaskMove: ((taskId: String, time: String, endTime: String) -> Unit)? = null,
) {
    val density = LocalDensity.current
    val hourHPx = with(density) { HOUR_H.toPx() }
    val pxPerMin = hourHPx / 60f

    // Текущее время и дата — обновляем раз в минуту для красной линии и isToday.
    var now by remember { mutableStateOf(nowMinutes()) }
    var todayStr by remember { mutableStateOf(LocalDate.now().toString()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            now = nowMinutes()
            todayStr = LocalDate.now().toString()
        }
    }
    val isToday = date == todayStr

    // Точка отсчёта для авто-раскладки задач без времени: текущее время (сегодня,
    // округлённое вниз до 30 мин, чтобы чипы не «прыгали») или 9:00.
    val placeFrom = if (isToday) now / 30 * 30 else 9 * 60
    val placed = remember(tasks, placeFrom) { layoutDay(tasks, placeFrom) }

    val gridHeight = HOUR_H * 24
    val scrollState = rememberScrollState()

    // При смене дня — прокрутить к текущему времени (сегодня) или к первому блоку.
    LaunchedEffect(date) {
        val target = when {
            isToday -> now
            placed.isNotEmpty() -> placed.minOf { it.startMin }
            else -> 9 * 60
        }
        val y = target / 60f * hourHPx - with(density) { 120.dp.toPx() }
        scrollState.scrollTo(y.roundToInt().coerceAtLeast(0))
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState),
        ) {
            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 20.dp, bottom = 120.dp),
            ) {
                val contentW = maxWidth

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(gridHeight)
                        // Тап по пустому полю → создать задачу, время округляем до 15 мин.
                        .pointerInput(hourHPx) {
                            detectTapGestures { offset ->
                                val min = offset.y / hourHPx * 60f
                                val rounded = (min / 15f).roundToInt() * 15
                                onCreateAt(formatTime(rounded))
                            }
                        },
                ) {
                    // Часовые линии и подписи
                    for (h in 0..23) {
                        Box(
                            modifier = Modifier
                                .offset(y = HOUR_H * h)
                                .padding(start = GUTTER)
                                .fillMaxWidth()
                                .height(1.dp)
                                .background(HourLineColor),
                        )
                        Text(
                            text = h.toString(),
                            style = TextStyle(fontFamily = Muller, fontSize = 13.sp, color = HourLabelColor),
                            modifier = Modifier.offset(x = 0.dp, y = HOUR_H * h - 8.dp),
                        )
                    }

                    // Блоки задач (со временем + прикинутые без времени)
                    placed.forEach { p ->
                        val blockW = (contentW - GUTTER - RIGHT_PAD - COL_GAP * (p.cols - 1)) / p.cols
                        val left = GUTTER + (blockW + COL_GAP) * p.col
                        val top = HOUR_H * (p.startMin / 60f)
                        val rawH = HOUR_H * ((p.endMin - p.startMin) / 60f) - 4.dp
                        val minH = if (p.untimed) 30.dp else 34.dp
                        TimelineBlock(
                            placed = p,
                            left = left,
                            top = top,
                            width = blockW,
                            height = maxOf(minH, rawH),
                            pxPerMin = pxPerMin,
                            onClick = { if (p.untimed) onUntimedClick(p.task) else onTaskClick(p.task) },
                            onMove = onTaskMove,
                        )
                    }

                    // Едущая красная линия текущего времени (только сегодня)
                    if (isToday) {
                        Row(
                            modifier = Modifier
                                .offset(y = HOUR_H * (now / 60f))
                                .padding(start = GUTTER - 7.dp)
                                .fillMaxWidth()
                                .zIndex(10f),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(9.dp)
                                    .clip(CircleShape)
                                    .background(NowLineColor),
                            )
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(2.dp)
                                    .background(NowLineColor),
                            )
                        }
                    }
                }
            }
        }

        // Градиент сверху — контент плавно уходит под край
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(Brush.verticalGradient(listOf(Color.White, Color.Transparent))),
        )
    }
}

/**
 * Один блок задачи. Long-press + перетаскивание по вертикали двигает время
 * с шагом 5 минут (длительность сохраняется) — порт TimelineBlock из веба.
 */
@Composable
private fun TimelineBlock(
    placed: PlacedTask,
    left: Dp,
    top: Dp,
    width: Dp,
    height: Dp,
    pxPerMin: Float,
    onClick: () -> Unit,
    onMove: ((taskId: String, time: String, endTime: String) -> Unit)?,
) {
    val task = placed.task
    val colors = TaskCategoryPalette.colors(task.category)
    val duration = placed.endMin - placed.startMin

    // Смещение по Y во время перетаскивания (px). null — не тащим.
    var dragDy by remember(task.id) { mutableStateOf<Float?>(null) }
    val isDragging = dragDy != null

    val start = parseTime(task.time)
    val end = parseTime(task.endTime)
    val timeLabel =
        if (start != null && end != null && end > start) "${task.time} - ${task.endTime}"
        else task.time

    val compact = placed.untimed || height < 52.dp
    val shape = RoundedCornerShape(if (placed.untimed) 12.dp else BLOCK_RADIUS)

    // Начало с учётом текущего перетаскивания (с привязкой и границами дня).
    fun snappedStart(dy: Float): Int {
        val deltaMin = (dy / pxPerMin / SNAP_MIN).roundToInt() * SNAP_MIN
        return (placed.startMin + deltaMin).coerceIn(0, 24 * 60 - duration)
    }

    Column(
        modifier = Modifier
            .offset(x = left, y = top)
            .offset { IntOffset(0, (dragDy ?: 0f).roundToInt()) }
            .size(width, height)
            .zIndex(if (isDragging) 20f else 1f)
            .alpha(if (task.done) 0.55f else 1f)
            .then(if (isDragging) Modifier.shadow(8.dp, shape) else Modifier)
            .clip(shape)
            .background(if (placed.untimed) UntimedBg else colors.bg)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .then(
                if (onMove != null) {
                    Modifier.pointerInput(task.id, pxPerMin, placed.startMin, duration) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { dragDy = 0f },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                dragDy = (dragDy ?: 0f) + dragAmount.y
                            },
                            onDragEnd = {
                                val newStart = snappedStart(dragDy ?: 0f)
                                if (newStart != placed.startMin) {
                                    onMove(task.id, formatTime(newStart), formatTime(newStart + duration))
                                }
                                dragDy = null
                            },
                            onDragCancel = { dragDy = null },
                        )
                    }
                } else {
                    Modifier
                },
            )
            .padding(
                horizontal = if (compact) 14.dp else 16.dp,
                vertical = if (compact) 6.dp else 9.dp,
            ),
        // Тонкие чипы центрируем; обычные блоки — по верхнему краю.
        verticalArrangement = Arrangement.spacedBy(
            2.dp,
            if (compact) Alignment.CenterVertically else Alignment.Top,
        ),
    ) {
        if (!compact && !placed.untimed) {
            Text(
                text = if (isDragging) formatTime(snappedStart(dragDy ?: 0f)) else timeLabel,
                style = TextStyle(fontFamily = Muller, fontSize = 11.sp, color = colors.textMuted),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = task.name,
            style = TextStyle(
                fontFamily = Muller,
                fontSize = if (placed.untimed) 13.sp else 15.sp,
                fontWeight = if (placed.untimed) FontWeight.Normal else FontWeight.Medium,
                color = if (placed.untimed) UntimedText else colors.text,
                lineHeight = if (placed.untimed) 15.6.sp else 18.sp,
                textDecoration = if (task.done) TextDecoration.LineThrough else TextDecoration.None,
            ),
            maxLines = if (compact) 1 else 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

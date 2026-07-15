package ru.mindex.app.ui.screens.calendar

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import kotlinx.coroutines.launch
import ru.mindex.app.data.model.Task
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.components.AddTaskModal
import ru.mindex.app.ui.components.BottomNav
import ru.mindex.app.ui.components.EditTaskModal
import ru.mindex.app.ui.components.TaskItem
import ru.mindex.app.ui.navigation.Routes
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.RandomGrotesque
import ru.mindex.app.ui.theme.TaskCategoryPalette
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

// Тексты и палитра — 1:1 с src/components/Calendar.tsx
private val MONTHS = listOf(
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)
private val WEEKDAYS = listOf("ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС")

private val HeaderText = Color(0xFF222224)
private val YearColor = Color(0x66222224)        // rgba(34,34,36,0.4)
private val WeekdayColor = Color(0x61222224)     // rgba(34,34,36,0.38)
private val OutMonthColor = Color(0x47222224)    // rgba(34,34,36,0.28)
private val SelectedBg = Color(0xFF222224)
private val TodayRing = Color(0x24222224)        // rgba(34,34,36,0.14)
private val EmptyStateColor = Color(0xFFBBBBBB)

/** Заголовок выбранного дня — «15 июля». */
private val DayTitleFormat = DateTimeFormatter.ofPattern("d MMMM", Locale("ru"))

/**
 * Экран календаря — порт src/components/Calendar.tsx.
 *
 * Месячная сетка с понедельника, свайп и стрелки для навигации по месяцам,
 * индикаторы задач в ячейках (цвет — категория задачи), под сеткой —
 * задачи выбранного дня и добавление через AddTaskModal.
 */
@Composable
fun CalendarScreen(appViewModel: AppViewModel, navController: NavHostController) {
    val scope = rememberCoroutineScope()
    val repo = appViewModel.container.dataRepository
    val tasks by appViewModel.tasks.collectAsState()

    val today = remember { LocalDate.now().toString() }
    var selectedDate by rememberSaveable { mutableStateOf(today) }
    var displayMonthStr by rememberSaveable { mutableStateOf(YearMonth.now().toString()) }
    var direction by remember { mutableStateOf(1) }
    var addSheetOpen by remember { mutableStateOf(false) }
    var editingTask by remember { mutableStateOf<Task?>(null) }

    val displayMonth = remember(displayMonthStr) { YearMonth.parse(displayMonthStr) }
    val tasksByDate = remember(tasks, today) {
        tasks.groupBy { it.date.ifEmpty { today } }
    }
    val dayTasks = remember(tasksByDate, selectedDate) {
        tasksByDate[selectedDate].orEmpty()
            .sortedWith(compareBy({ it.time.isEmpty() }, { it.time }))
    }

    // Смена месяца: выбранный день переносится в новый месяц (как в вебе).
    fun slideToMonth(delta: Int) {
        direction = delta
        val next = displayMonth.plusMonths(delta.toLong())
        displayMonthStr = next.toString()
        runCatching { LocalDate.parse(selectedDate) }.getOrNull()?.let { sel ->
            selectedDate = next.atDay(minOf(sel.dayOfMonth, next.lengthOfMonth())).toString()
        }
    }

    fun goToday() {
        val nowMonth = YearMonth.now()
        if (nowMonth != displayMonth) {
            direction = if (nowMonth > displayMonth) 1 else -1
            displayMonthStr = nowMonth.toString()
        }
        selectedDate = today
    }

    val swipeThresholdPx = with(LocalDensity.current) { 50.dp.toPx() }

    Box(modifier = Modifier.fillMaxSize().background(MindexColors.Bg)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(horizontal = 16.dp),
        ) {
            Spacer(modifier = Modifier.height(12.dp))

            // ─── Шапка: назад, ‹, год + месяц (тап — сегодня), › ─
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 4.dp, end = 4.dp, bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CalendarIconButton(onClick = { navController.popBackStack() }) {
                        ChevronIcon(pointsLeft = true)
                    }
                    CalendarIconButton(onClick = { slideToMonth(-1) }) {
                        ChevronIcon(pointsLeft = true)
                    }
                }

                AnimatedContent(
                    targetState = displayMonthStr,
                    transitionSpec = {
                        val dir = direction
                        (slideInVertically(tween(220)) { if (dir == 1) it / 2 else -it / 2 } + fadeIn(tween(220))) togetherWith
                            (slideOutVertically(tween(220)) { if (dir == 1) -it / 2 else it / 2 } + fadeOut(tween(220)))
                    },
                    label = "calendarMonthTitle",
                ) { monthStr ->
                    val m = YearMonth.parse(monthStr)
                    Column(
                        modifier = Modifier.clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { goToday() },
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = m.year.toString(),
                            style = TextStyle(
                                fontFamily = RandomGrotesque,
                                fontSize = 11.sp,
                                letterSpacing = 0.9.sp,
                                color = YearColor,
                            ),
                        )
                        Text(
                            text = MONTHS[m.monthValue - 1],
                            style = TextStyle(
                                fontFamily = RandomGrotesque,
                                fontSize = 20.sp,
                                color = HeaderText,
                            ),
                        )
                    }
                }

                CalendarIconButton(onClick = { slideToMonth(1) }) {
                    ChevronIcon(pointsLeft = false)
                }
            }

            // ─── Белая карточка с сеткой месяца ──────────────────
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color.White)
                    .padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 16.dp)
                    .horizontalSwipe(swipeThresholdPx) { dir -> slideToMonth(dir) },
            ) {
                // Дни недели
                Row(modifier = Modifier.fillMaxWidth()) {
                    WEEKDAYS.forEach { day ->
                        Text(
                            text = day,
                            style = TextStyle(
                                fontFamily = RandomGrotesque,
                                fontSize = 11.sp,
                                letterSpacing = 0.9.sp,
                                color = WeekdayColor,
                                textAlign = TextAlign.Center,
                            ),
                            modifier = Modifier
                                .weight(1f)
                                .padding(vertical = 4.dp),
                        )
                    }
                }

                // Сетка дней — слайд при смене месяца
                AnimatedContent(
                    targetState = displayMonthStr,
                    transitionSpec = {
                        val dir = direction
                        (slideInHorizontally(tween(260)) { (it * 0.28f * dir).roundToInt() } + fadeIn(tween(260))) togetherWith
                            (slideOutHorizontally(tween(260)) { (-it * 0.28f * dir).roundToInt() } + fadeOut(tween(260)))
                    },
                    label = "calendarMonthGrid",
                ) { monthStr ->
                    val month = YearMonth.parse(monthStr)
                    val grid = remember(monthStr) { buildMonthGrid(month) }
                    Column(
                        modifier = Modifier.padding(top = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        grid.chunked(7).forEach { week ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                week.forEach { date ->
                                    DayCell(
                                        date = date,
                                        month = month,
                                        selectedDate = selectedDate,
                                        today = today,
                                        dayTasks = tasksByDate[date.toString()].orEmpty(),
                                        onSelect = { selectedDate = it },
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // ─── Выбранный день: дата + добавление задачи ────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 4.dp, end = 4.dp, top = 20.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = remember(selectedDate) {
                        runCatching { LocalDate.parse(selectedDate).format(DayTitleFormat) }
                            .getOrDefault(selectedDate)
                    },
                    style = TextStyle(
                        fontFamily = RandomGrotesque,
                        fontSize = 16.sp,
                        color = MindexColors.Text80,
                    ),
                )
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(MindexColors.FabDark)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { addSheetOpen = true },
                    contentAlignment = Alignment.Center,
                ) {
                    PlusIcon(color = Color.White, modifier = Modifier.size(16.dp))
                }
            }

            // ─── Задачи выбранного дня ───────────────────────────
            if (dayTasks.isEmpty()) {
                Text(
                    text = "Нет задач на этот день",
                    style = TextStyle(
                        fontFamily = Muller,
                        fontSize = 15.sp,
                        color = EmptyStateColor,
                        textAlign = TextAlign.Center,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 40.dp),
                )
            } else {
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(start = 4.dp, end = 4.dp, bottom = 140.dp),
                ) {
                    items(dayTasks, key = { it.id }) { t ->
                        TaskItem(
                            task = t,
                            onToggle = { scope.launch { repo.toggleTask(t.id) } },
                            onClick = { editingTask = t },
                            onToggleSubtask = { taskId, subtaskId ->
                                val target = tasks.firstOrNull { it.id == taskId } ?: return@TaskItem
                                val updated = target.copy(
                                    subtasks = target.subtasks?.map { st ->
                                        if (st.id == subtaskId) st.copy(done = !st.done) else st
                                    },
                                )
                                scope.launch { repo.upsertTask(updated) }
                            },
                        )
                    }
                }
            }
        }

        // ─── Нижняя навигация ────────────────────────────────────
        Box(modifier = Modifier.align(Alignment.BottomCenter)) {
            BottomNav(navController = navController, current = Routes.CALENDAR)
        }
    }

    // ─── Шторки ──────────────────────────────────────────────────
    if (addSheetOpen) {
        AddTaskModal(
            initialDate = selectedDate,
            onDismiss = { addSheetOpen = false },
            onAdd = { newTask ->
                scope.launch { repo.upsertTask(newTask) }
                addSheetOpen = false
            },
        )
    }

    editingTask?.let { t ->
        EditTaskModal(
            task = t,
            onDismiss = { editingTask = null },
            onSave = { updated ->
                scope.launch { repo.upsertTask(updated) }
                editingTask = null
            },
            onDelete = { id ->
                scope.launch { repo.deleteTask(id) }
                editingTask = null
            },
        )
    }
}

// ─── Ячейка дня ─────────────────────────────────────────────────────────────

/**
 * День в сетке: скругление 14, выбранный — чёрный с тенью,
 * сегодня — кольцо; внизу до трёх точек-индикаторов задач
 * в цветах категорий.
 */
@Composable
private fun RowScope.DayCell(
    date: LocalDate,
    month: YearMonth,
    selectedDate: String,
    today: String,
    dayTasks: List<Task>,
    onSelect: (String) -> Unit,
) {
    val key = date.toString()
    val inMonth = YearMonth.from(date) == month
    val isToday = key == today
    val isSelected = key == selectedDate

    Box(
        modifier = Modifier
            .weight(1f)
            .aspectRatio(1f)
            .then(if (isSelected) Modifier.shadow(6.dp, RoundedCornerShape(14.dp)) else Modifier)
            .clip(RoundedCornerShape(14.dp))
            .background(if (isSelected) SelectedBg else Color.Transparent)
            .then(
                if (isToday && !isSelected) {
                    Modifier.border(1.dp, TodayRing, RoundedCornerShape(14.dp))
                } else {
                    Modifier
                },
            )
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { onSelect(key) },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = date.dayOfMonth.toString(),
            style = TextStyle(
                fontFamily = RandomGrotesque,
                fontSize = 16.sp,
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                color = when {
                    isSelected -> Color.White
                    inMonth -> HeaderText
                    else -> OutMonthColor
                },
            ),
        )

        // Индикаторы: точки задач (до трёх) либо точка «сегодня»
        val dots = dayTasks.take(3)
        if (dots.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                dots.forEach { t ->
                    Box(
                        modifier = Modifier
                            .size(4.dp)
                            .clip(CircleShape)
                            .background(
                                if (isSelected) Color.White
                                else TaskCategoryPalette.colors(t.category).text,
                            ),
                    )
                }
            }
        } else if (isToday && !isSelected) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 4.dp)
                    .size(4.dp)
                    .clip(CircleShape)
                    .background(HeaderText),
            )
        }
    }
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

/**
 * Сетка месяца — порт buildMonthGrid из Calendar.tsx:
 * понедельник первый, хвосты соседних месяцев, минимум 35 ячеек.
 */
private fun buildMonthGrid(month: YearMonth): List<LocalDate> {
    val firstDay = month.atDay(1)
    val lastDay = month.atEndOfMonth()
    val startOffset = firstDay.dayOfWeek.value - 1        // понедельник = 0
    val endOffset = 6 - (lastDay.dayOfWeek.value - 1)
    val totalDays = maxOf(35, month.lengthOfMonth() + startOffset + endOffset)
    val startDate = firstDay.minusDays(startOffset.toLong())
    return (0 until totalDays).map { startDate.plusDays(it.toLong()) }
}

/** Горизонтальный свайп: dir = 1 (влево → вперёд), -1 (вправо → назад). */
private fun Modifier.horizontalSwipe(thresholdPx: Float, onSwipe: (dir: Int) -> Unit): Modifier =
    pointerInput(thresholdPx) {
        var total = 0f
        detectHorizontalDragGestures(
            onDragStart = { total = 0f },
            onDragEnd = {
                if (abs(total) > thresholdPx) onSwipe(if (total < 0) 1 else -1)
            },
            onHorizontalDrag = { _, dragAmount -> total += dragAmount },
        )
    }

/** Тап-зона 36dp (w-9 h-9, как в вебе) для шевронов шапки. */
@Composable
private fun CalendarIconButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(CircleShape)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

// ─── Нарисованные иконки ────────────────────────────────────────────────────

@Composable
private fun ChevronIcon(pointsLeft: Boolean) {
    Canvas(modifier = Modifier.size(20.dp)) {
        val stroke = Stroke(width = size.width * 0.09f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val path = Path().apply {
            if (pointsLeft) {
                moveTo(size.width * 0.62f, size.height * 0.25f)
                lineTo(size.width * 0.38f, size.height * 0.5f)
                lineTo(size.width * 0.62f, size.height * 0.75f)
            } else {
                moveTo(size.width * 0.38f, size.height * 0.25f)
                lineTo(size.width * 0.62f, size.height * 0.5f)
                lineTo(size.width * 0.38f, size.height * 0.75f)
            }
        }
        drawPath(path = path, color = HeaderText, style = stroke)
    }
}

@Composable
private fun PlusIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = size.width * 0.12f, cap = StrokeCap.Round)
        drawPath(
            path = Path().apply {
                moveTo(size.width / 2f, size.height * 0.12f)
                lineTo(size.width / 2f, size.height * 0.88f)
                moveTo(size.width * 0.12f, size.height / 2f)
                lineTo(size.width * 0.88f, size.height / 2f)
            },
            color = color,
            style = stroke,
        )
    }
}

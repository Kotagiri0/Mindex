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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.components.BottomNav
import ru.mindex.app.ui.navigation.Routes
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.RandomGrotesque
import java.time.LocalDate
import java.time.YearMonth
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

/**
 * Экран календаря — порт src/components/Calendar.tsx (1:1).
 *
 * Месячная сетка с понедельника, свайп и стрелки для навигации по месяцам,
 * тап по заголовку месяца — прыжок к сегодняшнему дню.
 */
@Composable
fun CalendarScreen(appViewModel: AppViewModel, navController: NavHostController) {
    val today = remember { LocalDate.now().toString() }
    var selectedDate by rememberSaveable { mutableStateOf(today) }
    var displayMonthStr by rememberSaveable { mutableStateOf(YearMonth.now().toString()) }
    var direction by remember { mutableStateOf(1) }

    val displayMonth = remember(displayMonthStr) { YearMonth.parse(displayMonthStr) }

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
                    // min-h-[316px] — карточка не «прыгает» между месяцами в 5 и 6 строк (как в вебе)
                    .heightIn(min = 316.dp)
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
                                        onSelect = { selectedDate = it },
                                    )
                                }
                            }
                        }
                    }
                }
            }

        }

        // ─── Нижняя навигация — в вебе BottomNav виден на экране календаря ──
        Box(modifier = Modifier.align(Alignment.BottomCenter)) {
            BottomNav(navController = navController, current = Routes.CALENDAR)
        }
    }
}

// ─── Ячейка дня ─────────────────────────────────────────────────────────────

/**
 * День в сетке: скругление 14, выбранный — чёрный с тенью,
 * сегодня — кольцо и точка снизу (как в Calendar.tsx).
 */
@Composable
private fun RowScope.DayCell(
    date: LocalDate,
    month: YearMonth,
    selectedDate: String,
    today: String,
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

        // Точка «сегодня» снизу (только если день не выбран) — как в Calendar.tsx
        if (isToday && !isSelected) {
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


package ru.mindex.app.ui.screens.dashboard

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.mindex.app.data.model.Task
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.components.AddTaskModal
import ru.mindex.app.ui.components.BottomNav
import ru.mindex.app.ui.components.EditTaskModal
import ru.mindex.app.ui.components.TaskItem
import ru.mindex.app.ui.navigation.Routes
import ru.mindex.app.ui.screens.today.DayTimeline
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.RandomGrotesque
import ru.mindex.app.ui.theme.RussischSans
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.math.abs

// Тексты и палитра — 1:1 с src/components/Dashboard.tsx
private val MONTHS = listOf(
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
)
private val DAYS = listOf("ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС")

private val ScreenBg = Color(0xFFF0F0F0)
private val HeaderIconTint = Color(0x99222224)        // rgba(34,34,36,0.6)
private val DayNameColor = Color(0x66222224)          // rgba(34,34,36,0.4)
private val DayNameWeekend = Color(0x38222224)        // rgba(34,34,36,0.22)
private val DayNumColor = Color(0xFF999B9E)
private val DayNumWeekend = Color(0x47222224)         // rgba(34,34,36,0.28)
private val SelectedDayBg = Color(0xFF0B0D10)
private val TodayDayBg = Color(0x260B0D10)            // rgba(11,13,16,0.15)
private val AddFieldBg = Color(0xFFF5F5F5)
private val PlusTint = Color(0x4D222224)              // rgba(34,34,36,0.3)
private val EmptyStateColor = Color(0xFFBBBBBB)
private val MiniCalTodayBg = Color(0x240B0D10)        // rgba(11,13,16,0.14)
private val MiniCalWeekend = Color(0x4D222224)        // rgba(34,34,36,0.3)

/**
 * Главный экран задач — порт src/components/Dashboard.tsx (list-режим).
 *
 * Шапка с месяцем и настройками, свайпаемая недельная лента,
 * белая панель со строкой быстрого добавления и списком задач,
 * плавающая кнопка «Сегодня», мини-календарь и шторки Add/Edit.
 */
@Composable
fun DashboardScreen(appViewModel: AppViewModel, navController: NavHostController) {
    val scope = rememberCoroutineScope()
    val repo = appViewModel.container.dataRepository
    val tasks by appViewModel.tasks.collectAsState()
    val appContext = LocalContext.current.applicationContext

    var today by remember { mutableStateOf(LocalDate.now().toString()) }
    var selectedDate by remember { mutableStateOf(today) }
    var weekOffset by remember { mutableStateOf(0) }
    var addInput by remember { mutableStateOf("") }
    var editingTask by remember { mutableStateOf<Task?>(null) }
    var miniCalOpen by remember { mutableStateOf(false) }
    // Время, по которому тапнули на таймлайне для создания задачи (null — шторка закрыта).
    var createAt by remember { mutableStateOf<String?>(null) }

    // Вид панели: список или таймлайн дня. Запоминается навсегда (mx_dash_view в вебе).
    val prefs = remember {
        appContext.getSharedPreferences("mindex_ui", android.content.Context.MODE_PRIVATE)
    }
    var view by remember {
        mutableStateOf(prefs.getString("mx_dash_view", "list") ?: "list")
    }
    fun toggleView() {
        view = if (view == "list") "timeline" else "list"
        prefs.edit().putString("mx_dash_view", view).apply()
    }

    // Обновляем «сегодня» при смене суток — без перезапуска экрана.
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            val newToday = LocalDate.now().toString()
            if (newToday != today) {
                // Если пользователь смотрит на «старый сегодня» — переключаем на новый.
                if (selectedDate == today) selectedDate = newToday
                weekOffset = 0
                today = newToday
            }
        }
    }

    val weekDays = remember(weekOffset, today) { weekDaysFor(weekOffset) }

    val filteredTasks = remember(tasks, selectedDate, today) {
        tasks
            .filter { (it.date.ifEmpty { today }) == selectedDate }
            .sortedWith(compareBy({ it.time.isEmpty() }, { it.time }))
    }

    fun selectDate(ds: String) {
        selectedDate = ds
        val targetMonday = LocalDate.parse(ds).with(DayOfWeek.MONDAY)
        val nowMonday = LocalDate.now().with(DayOfWeek.MONDAY)
        weekOffset = ChronoUnit.WEEKS.between(nowMonday, targetMonday).toInt()
    }

    fun quickAdd() {
        val name = addInput.trim()
        if (name.isEmpty()) return
        val newTask = Task(
            id = UUID.randomUUID().toString(),
            name = name,
            time = "",
            date = selectedDate,
            done = false,
            category = "none",
        )
        scope.launch { repo.upsertTask(newTask) }
        addInput = ""
    }

    val swipeThresholdPx = with(LocalDensity.current) { 50.dp.toPx() }

    Box(modifier = Modifier.fillMaxSize().background(ScreenBg)) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {

            // ─── Шапка ───────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                // Переключатель список ⇄ таймлайн (как в вебе):
                // открыт список → иконка календаря; открыт таймлайн → иконка to-do.
                HeaderIconButton(onClick = { toggleView() }) {
                    Icon(
                        imageVector = if (view == "list") CalendarGridIconVector else TodoIconVector,
                        contentDescription = if (view == "list") "Календарь" else "Список",
                        tint = HeaderIconTint,
                        modifier = Modifier.size(22.dp),
                    )
                }

                // Месяц — тап открывает мини-календарь для прыжка по датам
                Column(
                    modifier = Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { miniCalOpen = true },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val midDay = weekDays[3]
                    if (midDay.year != LocalDate.now().year) {
                        Text(
                            text = midDay.year.toString(),
                            style = TextStyle(
                                fontFamily = RandomGrotesque,
                                fontSize = 11.sp,
                                letterSpacing = 0.7.sp,
                                color = DayNameColor,
                            ),
                        )
                    }
                    Text(
                        text = MONTHS[midDay.monthValue - 1],
                        style = TextStyle(
                            fontFamily = RandomGrotesque,
                            fontSize = 22.sp,
                            color = Color(0xB3222224), // #222224, opacity 0.7
                        ),
                    )
                }

                HeaderIconButton(onClick = { navController.navigate(Routes.SETTINGS) }) {
                    Icon(
                        imageVector = SettingsIconVector,
                        contentDescription = "Настройки",
                        tint = HeaderIconTint,
                        modifier = Modifier.size(26.dp),
                    )
                }
            }

            // ─── Недельная лента (свайп по неделям) ──────────
            AnimatedContent(
                targetState = weekOffset,
                transitionSpec = {
                    val dir = if (targetState > initialState) 1 else -1
                    (slideInHorizontally { dir * 60 } + fadeIn(tween(200))) togetherWith
                        (slideOutHorizontally { -dir * 60 } + fadeOut(tween(200)))
                },
                label = "weekStrip",
                modifier = Modifier.horizontalSwipe(swipeThresholdPx) { dir ->
                    // Как в вебе: свайп недели переносит и выбранный день на понедельник новой недели.
                    weekOffset += dir
                    selectedDate = weekDaysFor(weekOffset).first().toString()
                },
            ) { offset ->
                val days = weekDaysFor(offset)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 8.dp),
                ) {
                    days.forEachIndexed { i, d ->
                        val ds = d.toString()
                        val isSel = ds == selectedDate
                        val isToday = ds == today
                        val isWeekend = i >= 5
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                ) { selectedDate = ds }
                                .padding(vertical = 4.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                text = DAYS[i],
                                style = TextStyle(
                                    fontFamily = RussischSans,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    letterSpacing = 0.5.sp,
                                    color = if (isWeekend) DayNameWeekend else DayNameColor,
                                ),
                            )
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(
                                        when {
                                            isSel -> SelectedDayBg
                                            isToday -> TodayDayBg
                                            else -> Color.Transparent
                                        },
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    text = d.dayOfMonth.toString(),
                                    style = TextStyle(
                                        fontFamily = FontFamily.SansSerif,
                                        fontSize = 16.sp,
                                        fontWeight = if (isSel) FontWeight.Bold else FontWeight.Normal,
                                        color = when {
                                            isSel -> Color.White
                                            isToday -> SelectedDayBg
                                            isWeekend -> DayNumWeekend
                                            else -> DayNumColor
                                        },
                                    ),
                                )
                            }
                        }
                    }
                }
            }

            // ─── Панель задач (свайп по дням) ────────────────
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp))
                    .background(Color.White)
                    .horizontalSwipe(swipeThresholdPx) { dir ->
                        selectDate(LocalDate.parse(selectedDate).plusDays(dir.toLong()).toString())
                    },
            ) {
                if (view == "list") {
                // Строка быстрого добавления
                Box(modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 8.dp)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(CircleShape)
                            .background(AddFieldBg)
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        // Плюс — декоративный, как в вебе
                        PlusIcon(color = PlusTint, modifier = Modifier.size(18.dp))

                        BasicTextField(
                            value = addInput,
                            onValueChange = { addInput = it },
                            singleLine = true,
                            textStyle = TextStyle(
                                fontFamily = Muller,
                                fontSize = 15.sp,
                                color = Color(0xFF222224),
                            ),
                            cursorBrush = SolidColor(Color(0xFF222224)),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { quickAdd() }),
                            modifier = Modifier.weight(1f),
                            decorationBox = { inner ->
                                Box(contentAlignment = Alignment.CenterStart) {
                                    if (addInput.isEmpty()) {
                                        Text(
                                            text = "Добавить задачу",
                                            style = TextStyle(
                                                fontFamily = Muller,
                                                fontSize = 15.sp,
                                                color = PlusTint,
                                            ),
                                        )
                                    }
                                    inner()
                                }
                            },
                        )

                        AnimatedVisibility(
                            visible = addInput.isNotBlank(),
                            enter = scaleIn(tween(150)) + fadeIn(tween(150)),
                            exit = scaleOut(tween(150)) + fadeOut(tween(150)),
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .clip(CircleShape)
                                    .background(SelectedDayBg)
                                    .clickable(
                                        interactionSource = remember { MutableInteractionSource() },
                                        indication = null,
                                    ) { quickAdd() },
                                contentAlignment = Alignment.Center,
                            ) {
                                ArrowUpIcon(color = Color.White, modifier = Modifier.size(16.dp))
                            }
                        }
                    }
                }

                // Список задач / пустое состояние
                if (filteredTasks.isEmpty()) {
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
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            start = 20.dp, end = 20.dp, bottom = 120.dp,
                        ),
                    ) {
                        items(filteredTasks, key = { it.id }) { t ->
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
                } else {
                    // ─── Таймлайн дня (порт view === 'timeline' из Dashboard.tsx) ───
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .padding(top = 12.dp),
                    ) {
                        DayTimeline(
                            date = selectedDate,
                            tasks = filteredTasks,
                            onTaskClick = { editingTask = it },
                            onUntimedClick = { editingTask = it },
                            onCreateAt = { time -> createAt = time },
                            onTaskMove = { taskId, time, endTime ->
                                // Человек явно переместил блок → timeSource: 'user' (как в вебе).
                                tasks.firstOrNull { it.id == taskId }?.let { t ->
                                    scope.launch {
                                        repo.upsertTask(t.copy(time = time, endTime = endTime, timeSource = "user"))
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }

        // ─── Кнопка «Сегодня» — когда ушли с текущего дня ────
        AnimatedVisibility(
            visible = weekOffset != 0 || selectedDate != today,
            enter = fadeIn(tween(200)) + slideInVertically(tween(200)) { it / 2 },
            exit = fadeOut(tween(200)) + slideOutVertically(tween(200)) { it / 2 },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(bottom = 110.dp),
        ) {
            Box(
                modifier = Modifier
                    .shadow(4.dp, CircleShape)
                    .clip(CircleShape)
                    .background(Color.White)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) {
                        weekOffset = 0
                        selectedDate = today
                    }
                    .padding(horizontal = 20.dp, vertical = 9.dp),
            ) {
                Text(
                    text = "Сегодня",
                    style = TextStyle(
                        fontFamily = Muller,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = Color(0xFF222224),
                    ),
                )
            }
        }

        // ─── Нижняя навигация ────────────────────────────────
        Box(modifier = Modifier.align(Alignment.BottomCenter)) {
            BottomNav(navController = navController, current = Routes.DASH)
        }
    }

    // ─── Шторки ──────────────────────────────────────────────
    // Создание задачи тапом по пустому месту таймлайна — время предзаполнено.
    createAt?.let { time ->
        AddTaskModal(
            initialDate = selectedDate,
            initialTime = time,
            onDismiss = { createAt = null },
            onAdd = { newTask ->
                // Человек явно указал время на таймлайне → timeSource: 'user' (как в вебе).
                scope.launch { repo.upsertTask(newTask.copy(timeSource = "user")) }
                createAt = null
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

    if (miniCalOpen) {
        MiniCalendarSheet(
            selected = selectedDate,
            today = today,
            onSelect = { ds -> selectDate(ds) },
            onDismiss = { miniCalOpen = false },
        )
    }
}

// ─── Мини-календарь (порт MiniCalendar из Dashboard.tsx) ────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MiniCalendarSheet(
    selected: String,
    today: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val selDate = remember(selected) { runCatching { LocalDate.parse(selected) }.getOrDefault(LocalDate.now()) }
    var year by remember { mutableStateOf(selDate.year) }
    var month by remember { mutableStateOf(selDate.monthValue) } // 1..12

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Color.White,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 36.dp)
                .navigationBarsPadding(),
        ) {
            // Шапка: месяц + переключатели
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                HeaderIconButton(onClick = {
                    if (month == 1) { month = 12; year-- } else month--
                }) {
                    ChevronIcon(pointsLeft = true, color = Color(0xFF222224), modifier = Modifier.size(20.dp))
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = year.toString(),
                        style = TextStyle(
                            fontFamily = RandomGrotesque,
                            fontSize = 11.sp,
                            letterSpacing = 0.7.sp,
                            color = DayNameColor,
                        ),
                    )
                    Text(
                        text = MONTHS[month - 1],
                        style = TextStyle(
                            fontFamily = RandomGrotesque,
                            fontSize = 20.sp,
                            color = Color(0xFF222224),
                        ),
                    )
                }
                HeaderIconButton(onClick = {
                    if (month == 12) { month = 1; year++ } else month++
                }) {
                    ChevronIcon(pointsLeft = false, color = Color(0xFF222224), modifier = Modifier.size(20.dp))
                }
            }

            // Дни недели
            Row(modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                DAYS.forEach { d ->
                    Text(
                        text = d,
                        style = TextStyle(
                            fontFamily = RandomGrotesque,
                            fontSize = 11.sp,
                            letterSpacing = 0.5.sp,
                            color = DayNameColor,
                            textAlign = TextAlign.Center,
                        ),
                        modifier = Modifier.weight(1f).padding(vertical = 4.dp),
                    )
                }
            }

            // Сетка дней
            val firstDay = LocalDate.of(year, month, 1)
            val startDow = firstDay.dayOfWeek.value - 1 // понедельник = 0
            val daysInMonth = YearMonth.of(year, month).lengthOfMonth()
            val cells: List<Int?> = buildList {
                repeat(startDow) { add(null) }
                (1..daysInMonth).forEach { add(it) }
                while (size % 7 != 0) add(null)
            }
            cells.chunked(7).forEach { week ->
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 1.dp)) {
                    week.forEachIndexed { idx, day ->
                        Box(
                            modifier = Modifier.weight(1f),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (day != null) {
                                val ds = LocalDate.of(year, month, day).toString()
                                val isSel = ds == selected
                                val isToday = ds == today
                                val isWeekend = idx >= 5
                                Box(
                                    modifier = Modifier
                                        .size(36.dp)
                                        .clip(CircleShape)
                                        .background(
                                            when {
                                                isSel -> SelectedDayBg
                                                isToday -> MiniCalTodayBg
                                                else -> Color.Transparent
                                            },
                                        )
                                        .clickable(
                                            interactionSource = remember { MutableInteractionSource() },
                                            indication = null,
                                        ) {
                                            onSelect(ds)
                                            onDismiss()
                                        },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        text = day.toString(),
                                        style = TextStyle(
                                            // В вебе: Helvetica для выбранного/сегодня, Muller для остальных.
                                            fontFamily = if (isSel || isToday) FontFamily.SansSerif else Muller,
                                            fontSize = 15.sp,
                                            fontWeight = if (isSel || isToday) FontWeight.Bold else FontWeight.Normal,
                                            color = when {
                                                isSel || isToday -> Color.White
                                                isWeekend -> MiniCalWeekend
                                                else -> DayNumColor
                                            },
                                        ),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

/** 7 дней недели с учётом смещения (понедельник — первый). */
private fun weekDaysFor(offset: Int): List<LocalDate> {
    val monday = LocalDate.now().with(DayOfWeek.MONDAY).plusWeeks(offset.toLong())
    return (0..6).map { monday.plusDays(it.toLong()) }
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

/** Тап-зона 44dp для иконок шапки. */
@Composable
private fun HeaderIconButton(onClick: () -> Unit, content: @Composable () -> Unit) {
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
        content()
    }
}

// ─── Простые нарисованные иконки ────────────────────────────────────────────

@Composable
private fun PlusIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = size.width * 0.1f, cap = StrokeCap.Round)
        val path = Path().apply {
            moveTo(size.width / 2f, size.height * 0.12f)
            lineTo(size.width / 2f, size.height * 0.88f)
            moveTo(size.width * 0.12f, size.height / 2f)
            lineTo(size.width * 0.88f, size.height / 2f)
        }
        drawPath(path = path, color = color, style = stroke)
    }
}

@Composable
private fun ArrowUpIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = size.width * 0.13f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val path = Path().apply {
            moveTo(size.width / 2f, size.height * 0.85f)
            lineTo(size.width / 2f, size.height * 0.15f)
            moveTo(size.width * 0.2f, size.height * 0.45f)
            lineTo(size.width / 2f, size.height * 0.15f)
            lineTo(size.width * 0.8f, size.height * 0.45f)
        }
        drawPath(path = path, color = color, style = stroke)
    }
}

@Composable
private fun ChevronIcon(pointsLeft: Boolean, color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
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
        drawPath(path = path, color = color, style = stroke)
    }
}

// ─── Иконки шапки (порт src/components/icons/index.tsx) ─────────────────────

/** Календарь с сеткой точек — вход в экран календаря. Источник: calendar 2.svg. */
private val CalendarGridIconVector: ImageVector = ImageVector.Builder(
    name = "MindexCalendarGrid",
    defaultWidth = 22.dp,
    defaultHeight = 22.dp,
    viewportWidth = 81f,
    viewportHeight = 91f,
).addPath(
    pathData = addPathNodes(
        "M56.7002 0.0498047C58.9093 0.0498046 60.7012 1.84067 60.7012 4.0498V10.502C72.3573 " +
            "13.3812 81.001 23.9068 81.001 36.4521V63.9912C81.001 78.7536 69.0329 90.7214 " +
            "54.2705 90.7217H26.7314L26.041 90.7129C11.5973 90.3469 0 78.5231 0 63.9912V" +
            "36.4521C0 24.1988 8.24546 13.8707 19.4902 10.7139V4.0498C19.4902 1.84067 " +
            "21.2811 0.0498048 23.4902 0.0498047C25.6994 0.0498047 27.4902 1.84067 27.4902 " +
            "4.0498V9.72168H52.7012V4.0498C52.7012 1.84083 54.4913 0.0500685 56.7002 " +
            "0.0498047ZM26.7314 17.7217C16.3872 17.7217 8.00098 26.1079 8.00098 36.4521V" +
            "63.9912C8.00098 74.3355 16.3872 82.7217 26.7314 82.7217H54.2705C64.6146 82.7214 " +
            "73.001 74.3353 73.001 63.9912V36.4521C73.001 26.108 64.6146 17.7219 54.2705 " +
            "17.7217H26.7314Z" +
            "M21 49a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z" +
            "M36 49a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z" +
            "M51 49a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z" +
            "M21 64a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z" +
            "M36 64a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z" +
            "M51 64a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z",
    ),
    fill = SolidColor(Color.Black),
).build()

/** Чек-в-скобке (to-do) — переключатель обратно в список. Источник: to-do.svg. */
private val TodoIconVector: ImageVector = ImageVector.Builder(
    name = "MindexTodo",
    defaultWidth = 22.dp,
    defaultHeight = 22.dp,
    viewportWidth = 81f,
    viewportHeight = 81f,
).addPath(
    pathData = addPathNodes("M77.0001 4L40.0005 50L24.0781 32.716"),
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 8f,
    strokeLineCap = StrokeCap.Round,
).addPath(
    pathData = addPathNodes(
        "M54.2695 0C57.2101 0 60.0393 0.476324 62.6855 1.35352L57.1982 8.22852C56.244 " +
            "8.07865 55.2659 8 54.2695 8H26.7305C16.3862 8 8 16.3862 8 26.7305V54.2695C8 " +
            "64.6138 16.3862 73 26.7305 73H54.2695C64.6138 73 73 64.6138 73 54.2695V" +
            "30.1318L80.3613 20.9082C80.7778 22.7827 81 24.7306 81 26.7305V54.2695C81 " +
            "69.0321 69.0321 81 54.2695 81H26.7305L26.04 80.9912C11.5963 80.6253 0 68.8014 " +
            "0 54.2695V26.7305C0 12.1986 11.5963 0.374748 26.04 0.00878906L26.7305 0H54.2695Z",
    ),
    fill = SolidColor(Color.Black),
).build()

/** Шестерёнка (outline) — настройки. Источник: settings.svg. */
private val SettingsIconVector: ImageVector = ImageVector.Builder(
    name = "MindexSettings",
    defaultWidth = 26.dp,
    defaultHeight = 26.dp,
    viewportWidth = 81f,
    viewportHeight = 91f,
).addPath(
    pathData = addPathNodes(
        "M31.3947 16.6948C36.3675 10.6405 45.6333 10.6405 50.6061 16.6948C52.3654 18.8366 " +
            "54.79 20.3291 57.4946 20.935L59.7155 21.4324C68.3219 23.3604 73.4861 32.1845 " +
            "70.9517 40.6324C70.097 43.4814 70.097 46.5186 70.9517 49.3676C73.4861 57.8155 " +
            "68.3219 66.6396 59.7155 68.5676L57.4947 69.065C54.79 69.6709 52.3654 71.1634 " +
            "50.6061 73.3052C45.6333 79.3595 36.3675 79.3595 31.3947 73.3052C29.6354 71.1634 " +
            "27.2108 69.6709 24.5061 69.065L22.1256 68.5318C13.731 66.6513 8.85493 57.8698 " +
            "11.6968 49.7502C12.7732 46.6749 12.7732 43.3251 11.6968 40.2498C8.85493 32.1302 " +
            "13.7309 23.3487 22.1255 21.4682L24.5061 20.935C27.2108 20.3291 29.6354 18.8366 " +
            "31.3947 16.6948Z",
    ),
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 8f,
).addPath(
    pathData = addPathNodes("M30 45a11 11 0 1 0 22 0a11 11 0 1 0 -22 0Z"),
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 8f,
).build()

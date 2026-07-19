package ru.mindex.app.ui.screens.today

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
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
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.RandomGrotesque
import java.time.DayOfWeek
import java.time.LocalDate
import java.util.Locale
import kotlin.math.abs

/*
 * Экран «Сегодня» — порт src/components/TodayMobile.tsx + DayTimeline.tsx.
 *
 * Шапка с днём недели, список задач без времени (с чекбоксами),
 * белая панель с часовой сеткой дня. Свайп влево/вправо — навигация по дням,
 * кнопка «Сегодня» возвращает к текущему дню.
 */

// Тексты — 1:1 с TodayMobile.tsx (DAY_NAMES).
private val DAY_NAMES = mapOf(
    DayOfWeek.SUNDAY to "воскресенье",
    DayOfWeek.MONDAY to "понедельник",
    DayOfWeek.TUESDAY to "вторник",
    DayOfWeek.WEDNESDAY to "среда",
    DayOfWeek.THURSDAY to "четверг",
    DayOfWeek.FRIDAY to "пятница",
    DayOfWeek.SATURDAY to "суббота",
)

// Цвета — 1:1 с TodayMobile.tsx / DESIGN.md.
private val ScreenBg = Color(0xFFF0F0F0)
private val HeaderIconTint = Color(0x730B0D10)   // rgba(11,13,16,0.45)
private val DayNameColor = Color(0xBF0B0D10)     // rgba(11,13,16,0.75)
private val DateColor = Color(0x4D090E17)        // rgba(9,14,23,0.3) — --text-30
private val EmptyStateColor = Color(0xFFBBBBBB)  // как в Dashboard.tsx

@Composable
fun TodayScreen(appViewModel: AppViewModel, navController: NavHostController) {
    val scope = rememberCoroutineScope()
    val repo = appViewModel.container.dataRepository
    val tasks by appViewModel.tasks.collectAsState()

    var today by remember { mutableStateOf(LocalDate.now().toString()) }
    var selectedDate by remember { mutableStateOf(today) }
    var editingTask by remember { mutableStateOf<Task?>(null) }
    // Время, по которому тапнули на таймлайне для создания задачи (null — шторка закрыта).
    var createAt by remember { mutableStateOf<String?>(null) }
    // Только что выполненные — держим в списке 800 мс, как в TodayMobile.tsx.
    val justDone = remember { mutableStateListOf<String>() }

    // Обновляем «сегодня» при смене суток.
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            val newToday = LocalDate.now().toString()
            if (newToday != today) {
                if (selectedDate == today) selectedDate = newToday
                today = newToday
            }
        }
    }

    val dayTasks = remember(tasks, selectedDate, today) {
        tasks.filter { (it.date.ifEmpty { today }) == selectedDate }
    }
    // На сетку — задачи со временем или с предложенным агентом слотом.
    val timelineTasks = remember(dayTasks) {
        dayTasks.filter { parseTime(it.time) != null || parseTime(it.suggestedTime) != null }
    }
    // Списком — задачи без времени; выполненные скрываем (кроме только что отмеченных).
    val untimedTasks = dayTasks.filter {
        parseTime(it.time) == null && parseTime(it.suggestedTime) == null &&
            (!it.done || justDone.contains(it.id))
    }

    fun toggleTask(task: Task) {
        val completing = !task.done
        scope.launch { repo.toggleTask(task.id) }
        if (completing) {
            justDone.add(task.id)
            scope.launch {
                delay(800)
                justDone.remove(task.id)
            }
        }
    }

    val selectedLocalDate = remember(selectedDate) {
        runCatching { LocalDate.parse(selectedDate) }.getOrDefault(LocalDate.now())
    }
    val swipeThresholdPx = with(LocalDensity.current) { 50.dp.toPx() }

    Box(modifier = Modifier.fillMaxSize().background(ScreenBg)) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {

            // ─── Шапка (порт хедера TodayMobile.tsx) ─────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                HeaderIconButton(onClick = {
                    if (!navController.popBackStack()) navController.navigate(Routes.DASH)
                }) {
                    ChevronIcon(pointsLeft = true, color = HeaderIconTint, modifier = Modifier.size(24.dp))
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    // Дата «24.04.26» — как на экране «Сегодня» в DESIGN.md
                    Text(
                        text = String.format(
                            Locale.US,
                            "%02d.%02d.%02d",
                            selectedLocalDate.dayOfMonth,
                            selectedLocalDate.monthValue,
                            selectedLocalDate.year % 100,
                        ),
                        style = TextStyle(fontFamily = Muller, fontSize = 13.sp, color = DateColor),
                    )
                    Text(
                        text = DAY_NAMES.getValue(selectedLocalDate.dayOfWeek),
                        style = TextStyle(
                            fontFamily = RandomGrotesque,
                            fontSize = 18.sp,
                            color = DayNameColor,
                        ),
                    )
                }

                HeaderIconButton(onClick = { navController.navigate(Routes.SETTINGS) }) {
                    Icon(
                        imageVector = SettingsIconVector,
                        contentDescription = "Настройки",
                        tint = HeaderIconTint,
                        modifier = Modifier.size(24.dp),
                    )
                }
            }

            // ─── Задачи без времени — над панелью, на сером фоне ──
            if (untimedTasks.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 260.dp)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp),
                ) {
                    untimedTasks.forEach { t ->
                        TaskItem(
                            task = t,
                            onToggle = { toggleTask(t) },
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

            // ─── Панель таймлайна (свайп по дням) ────────────
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp))
                    .background(Color.White)
                    .horizontalSwipe(swipeThresholdPx) { dir ->
                        selectedDate = selectedLocalDate.plusDays(dir.toLong()).toString()
                    },
            ) {
                Box(modifier = Modifier.fillMaxSize().padding(top = 12.dp)) {
                    DayTimeline(
                        date = selectedDate,
                        tasks = timelineTasks,
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
                    }
                }
            }
        }

        // ─── Кнопка «Сегодня» — когда ушли с текущего дня ────
        AnimatedVisibility(
            visible = selectedDate != today,
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
                    ) { selectedDate = today }
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
            BottomNav(navController = navController, current = Routes.TODAY)
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
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

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

/** Шестерёнка (outline) — настройки. Источник: settings.svg (icons/index.tsx). */
private val SettingsIconVector: ImageVector = ImageVector.Builder(
    name = "MindexSettingsToday",
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

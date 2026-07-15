package ru.mindex.app.ui.components

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.mindex.app.data.model.SubTask
import ru.mindex.app.data.model.Task
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.TaskCategoryPalette
import java.time.LocalDate
import java.util.Locale
import java.util.UUID

/**
 * Шторка «Новая задача» — порт src/components/AddTaskModal.tsx,
 * дополненный концом интервала, категорией и подзадачами (как в EditTaskModal).
 *
 * Собирает готовый Task и отдаёт наверх через [onAdd].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddTaskModal(
    initialDate: String,
    onDismiss: () -> Unit,
    onAdd: (Task) -> Unit,
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var name by rememberSaveable { mutableStateOf("") }
    var time by rememberSaveable { mutableStateOf("") }
    var endTime by rememberSaveable { mutableStateOf("") }
    var date by rememberSaveable { mutableStateOf(initialDate) }
    var category by rememberSaveable { mutableStateOf("none") }
    val subtasks = remember { emptyList<SubTask>().toMutableStateList() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MindexColors.Surface,
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
        dragHandle = { SheetDragHandle() },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 18.dp, end = 18.dp, bottom = 32.dp)
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Text(
                text = "Новая задача",
                style = TextStyle(
                    fontFamily = Muller,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = MindexColors.TextPrimary,
                ),
                modifier = Modifier.padding(bottom = 14.dp),
            )

            // ─── Название ────────────────────────────────────
            FieldLabel("Название")
            InputBox {
                SheetTextField(
                    value = name,
                    onValueChange = { name = it },
                    placeholder = "Что нужно сделать?",
                )
            }
            Box(Modifier.height(12.dp))

            // ─── Время / Конец ───────────────────────────────
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f)) {
                    FieldLabel("Время")
                    PickerBox(
                        value = time,
                        placeholder = "—:—",
                        onClick = { showTimePickerDialog(context, time) { time = it } },
                    )
                }
                Column(Modifier.weight(1f)) {
                    FieldLabel("Конец")
                    PickerBox(
                        value = endTime,
                        placeholder = "—:—",
                        onClick = { showTimePickerDialog(context, endTime) { endTime = it } },
                    )
                }
            }
            Box(Modifier.height(12.dp))

            // ─── Дата ────────────────────────────────────────
            FieldLabel("Дата")
            PickerBox(
                value = formatDateRu(date),
                placeholder = "В какой день?",
                onClick = { showDatePickerDialog(context, date) { date = it } },
            )
            Box(Modifier.height(14.dp))

            // ─── Категория ───────────────────────────────────
            CategoryPicker(value = category, onChange = { category = it })
            Box(Modifier.height(14.dp))

            // ─── Подзадачи ───────────────────────────────────
            if (subtasks.isNotEmpty()) {
                FieldLabel("Подзадачи")
                subtasks.forEachIndexed { index, st ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(Modifier.weight(1f)) {
                            InputBox {
                                SheetTextField(
                                    value = st.name,
                                    onValueChange = { subtasks[index] = st.copy(name = it) },
                                    placeholder = "Подзадача",
                                )
                            }
                        }
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                ) { subtasks.removeAt(index) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = "×",
                                style = TextStyle(
                                    fontFamily = Muller,
                                    fontSize = 20.sp,
                                    color = Color(0x66222224),
                                ),
                            )
                        }
                    }
                }
            }
            Text(
                text = "+ Добавить подзадачу",
                style = TextStyle(fontFamily = Muller, fontSize = 14.sp, color = Color(0x99222224)),
                modifier = Modifier
                    .clip(CircleShape)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { subtasks.add(SubTask(id = UUID.randomUUID().toString(), name = "")) }
                    .padding(vertical = 8.dp, horizontal = 4.dp),
            )
            Box(Modifier.height(6.dp))

            // ─── Кнопка «Создать задачу» ─────────────────────
            val canSubmit = name.isNotBlank()
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(if (canSubmit) MindexColors.Accent else Color(0x2E0B0D10))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        enabled = canSubmit,
                    ) {
                        onAdd(
                            Task(
                                id = UUID.randomUUID().toString(),
                                name = name.trim(),
                                time = time,
                                date = date,
                                done = false,
                                endTime = endTime.takeIf { it.isNotEmpty() },
                                category = category,
                                subtasks = subtasks
                                    .filter { it.name.isNotBlank() }
                                    .map { it.copy(name = it.name.trim()) }
                                    .takeIf { it.isNotEmpty() },
                                timeSource = "user",
                            ),
                        )
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "Создать задачу",
                    style = TextStyle(
                        fontFamily = Muller,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    ),
                )
            }
        }
    }
}

// ─── Общие детали шторок (используются и в EditTaskModal) ───────────────────

/** Ручка шторки — 36×4, как в вебе. */
@Composable
internal fun SheetDragHandle() {
    Box(
        modifier = Modifier
            .padding(top = 12.dp, bottom = 12.dp)
            .size(width = 36.dp, height = 4.dp)
            .clip(CircleShape)
            .background(Color(0x1F222224)),
    )
}

/** Ярлык поля — 11sp bold uppercase, как в AddTaskModal.tsx. */
@Composable
internal fun FieldLabel(text: String) {
    Text(
        text = text.uppercase(Locale("ru")),
        style = TextStyle(
            fontFamily = Muller,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
            color = MindexColors.Text40,
        ),
        modifier = Modifier.padding(bottom = 4.dp),
    )
}

/** Контейнер поля ввода — Surface2, радиус 12, высота 46. */
@Composable
internal fun InputBox(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(46.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MindexColors.Surface2)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        content()
    }
}

/** Текстовое поле в стиле веба: Muller 15, без рамок, с плейсхолдером. */
@Composable
internal fun SheetTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    singleLine: Boolean = true,
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        singleLine = singleLine,
        textStyle = TextStyle(
            fontFamily = Muller,
            fontSize = 15.sp,
            fontWeight = if (value.isNotEmpty()) FontWeight.Medium else FontWeight.Normal,
            color = Color(0xFF0B0D10),
        ),
        cursorBrush = SolidColor(MindexColors.Accent),
        modifier = Modifier.fillMaxWidth(),
        decorationBox = { inner ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) {
                    Text(
                        text = placeholder,
                        style = TextStyle(
                            fontFamily = Muller,
                            fontSize = 15.sp,
                            color = Color(0x4D0B0D10),
                        ),
                    )
                }
                inner()
            }
        },
    )
}

/** Поле-кнопка, открывающее системный пикер (время/дата). */
@Composable
internal fun PickerBox(value: String, placeholder: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(46.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MindexColors.Surface2)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text = value.ifEmpty { placeholder },
            style = TextStyle(
                fontFamily = Muller,
                fontSize = 15.sp,
                fontWeight = if (value.isNotEmpty()) FontWeight.Medium else FontWeight.Normal,
                color = if (value.isNotEmpty()) Color(0xFF0B0D10) else Color(0x4D0B0D10),
            ),
        )
    }
}

/**
 * Пикер категории — порт CategoryPicker из EditTaskModal.tsx.
 * Активная категория пружинно разворачивается из кружка в пилюлю с подписью.
 */
@Composable
internal fun CategoryPicker(value: String, onChange: (String) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
        TaskCategoryPalette.ordered.forEach { cat ->
            val c = TaskCategoryPalette.colors(cat)
            val active = value == cat
            val width by animateDpAsState(
                targetValue = if (active) 140.dp else 36.dp,
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioNoBouncy,
                    stiffness = Spring.StiffnessMedium,
                ),
                label = "categoryWidth",
            )
            val height by animateDpAsState(
                targetValue = if (active) 52.dp else 36.dp,
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioNoBouncy,
                    stiffness = Spring.StiffnessMedium,
                ),
                label = "categoryHeight",
            )
            Box(
                modifier = Modifier
                    .width(width)
                    .height(height)
                    .clip(CircleShape)
                    .background(c.bg)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { onChange(cat) },
                contentAlignment = Alignment.Center,
            ) {
                androidx.compose.animation.AnimatedVisibility(
                    visible = active,
                    enter = fadeIn(),
                    exit = fadeOut(),
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            text = "категория",
                            style = TextStyle(fontFamily = Muller, fontSize = 11.sp, color = c.textMuted),
                            maxLines = 1,
                        )
                        Text(
                            text = (TaskCategoryPalette.labels[cat] ?: cat).lowercase(),
                            style = TextStyle(
                                fontFamily = Muller,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Medium,
                                color = c.text,
                            ),
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

// ─── Системные пикеры и форматирование ──────────────────────────────────────

/** Открывает системный 24-часовой пикер времени; результат "HH:MM". */
internal fun showTimePickerDialog(context: Context, current: String, onPicked: (String) -> Unit) {
    val parts = current.split(":")
    val hour = parts.getOrNull(0)?.toIntOrNull() ?: 12
    val minute = parts.getOrNull(1)?.toIntOrNull() ?: 0
    TimePickerDialog(
        context,
        { _, h, m -> onPicked(String.format(Locale.US, "%02d:%02d", h, m)) },
        hour,
        minute,
        true,
    ).show()
}

/** Открывает системный пикер даты; результат ISO "yyyy-MM-dd". */
internal fun showDatePickerDialog(context: Context, current: String, onPicked: (String) -> Unit) {
    val initial = runCatching { LocalDate.parse(current) }.getOrDefault(LocalDate.now())
    DatePickerDialog(
        context,
        { _, y, m, d -> onPicked(LocalDate.of(y, m + 1, d).toString()) },
        initial.year,
        initial.monthValue - 1,
        initial.dayOfMonth,
    ).show()
}

/** "yyyy-MM-dd" → "dd.MM.yyyy" (как formatDateRu в вебе). */
internal fun formatDateRu(dateStr: String): String {
    if (dateStr.isEmpty()) return ""
    val parts = dateStr.split("-")
    if (parts.size != 3) return dateStr
    return "${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}"
}

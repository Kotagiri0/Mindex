package ru.mindex.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.mindex.app.data.model.Task
import ru.mindex.app.ui.theme.Muller

// Цвета — 1:1 с src/components/EditTaskModal.tsx
private val FieldBg = Color(0xFFF5F5F5)
private val ValueColor = Color(0xFF0B0D10)
private val PlaceholderColor = Color(0x4D0B0D10)      // rgba(11,13,16,0.3)
private val DeleteBg = Color(0xFFFFF0F0)
private val DeleteText = Color(0xFFE53935)
private val SaveDisabledBg = Color(0x2E0B0D10)        // rgba(11,13,16,0.18)
private val IconTint = Color(0xFF7E7F80)

/**
 * Шторка «Поменять» — порт src/components/EditTaskModal.tsx.
 *
 * Поля: название, время начала/конца, дата, место, описание, категория.
 * Действия: «Убрать» (удалить) и «Сохранить».
 * [onSave] получает готовую обновлённую копию задачи —
 * с той же логикой timeSource/suggestedTime, что в вебе.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditTaskModal(
    task: Task,
    onDismiss: () -> Unit,
    onSave: (Task) -> Unit,
    onDelete: (String) -> Unit,
) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var name by remember(task.id) { mutableStateOf(task.name) }
    var time by remember(task.id) { mutableStateOf(task.time) }
    var endTime by remember(task.id) { mutableStateOf(task.endTime ?: "") }
    var date by remember(task.id) { mutableStateOf(task.date) }
    var description by remember(task.id) { mutableStateOf(task.description ?: "") }
    var location by remember(task.id) { mutableStateOf(task.location ?: "") }
    var category by remember(task.id) { mutableStateOf(task.category ?: "none") }
    val initialTime = remember(task.id) { task.time }
    val initialEnd = remember(task.id) { task.endTime ?: "" }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Color.White,
        shape = RoundedCornerShape(topStart = 36.dp, topEnd = 36.dp),
        dragHandle = { SheetDragHandle() },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 23.dp, end = 23.dp, bottom = 20.dp)
                .navigationBarsPadding()
                .imePadding(),
        ) {
            // Заголовок
            Text(
                text = "Поменять",
                style = TextStyle(
                    fontFamily = Muller,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Medium,
                    color = ValueColor,
                    textAlign = TextAlign.Center,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 14.dp),
            )

            // ─── Название ────────────────────────────────────
            FieldBox {
                SheetTextField(
                    value = name,
                    onValueChange = { name = it },
                    placeholder = "Что на повестке дня?",
                )
            }
            Box(Modifier.height(17.dp))

            // ─── Время начала / конца ────────────────────────
            Row(horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                Box(Modifier.weight(1f)) {
                    FieldBox(onClick = { showTimePickerDialog(context, time) { time = it } }) {
                        FieldValueWithIcon(
                            value = time,
                            placeholder = "—:—",
                            icon = TaskTimeIconVector,
                        )
                    }
                }
                Box(Modifier.weight(1f)) {
                    FieldBox(onClick = { showTimePickerDialog(context, endTime) { endTime = it } }) {
                        FieldValueWithIcon(
                            value = endTime,
                            placeholder = "—:—",
                            icon = TaskTimeIconVector,
                        )
                    }
                }
            }
            Box(Modifier.height(17.dp))

            // ─── Дата ────────────────────────────────────────
            FieldBox(onClick = { showDatePickerDialog(context, date) { date = it } }) {
                FieldValueWithIcon(
                    value = formatDateRu(date),
                    placeholder = "В какой день?",
                    icon = TaskDateIconVector,
                )
            }
            Box(Modifier.height(17.dp))

            // ─── Место ───────────────────────────────────────
            FieldBox {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        SheetTextField(
                            value = location,
                            onValueChange = { location = it },
                            placeholder = "Где будет проходить?",
                        )
                    }
                    Icon(
                        imageVector = TaskPlaceIconVector,
                        contentDescription = null,
                        tint = Color.Unspecified,
                        modifier = Modifier.size(20.dp).alpha(0.45f),
                    )
                }
            }
            Box(Modifier.height(17.dp))

            // ─── Описание ────────────────────────────────────
            FieldBox {
                BasicTextField(
                    value = description,
                    onValueChange = { description = it },
                    textStyle = TextStyle(
                        fontFamily = Muller,
                        fontSize = 15.sp,
                        fontWeight = if (description.isNotEmpty()) FontWeight.Medium else FontWeight.Normal,
                        color = ValueColor,
                        lineHeight = 22.5.sp, // 15px × 1.5, как в вебе
                    ),
                    cursorBrush = SolidColor(ValueColor),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 66.dp),
                    decorationBox = { inner ->
                        Box {
                            if (description.isEmpty()) {
                                Text(
                                    text = "Описание, если нужно подробнее",
                                    style = TextStyle(
                                        fontFamily = Muller,
                                        fontSize = 15.sp,
                                        color = PlaceholderColor,
                                    ),
                                )
                            }
                            inner()
                        }
                    },
                )
            }
            Box(Modifier.height(17.dp))

            // ─── Категория ───────────────────────────────────
            CategoryPicker(value = category, onChange = { category = it })

            // ─── Кнопки ──────────────────────────────────────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 17.dp),
                horizontalArrangement = Arrangement.spacedBy(13.dp),
            ) {
                // Убрать
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(CircleShape)
                        .background(DeleteBg)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { onDelete(task.id) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "Убрать",
                        style = TextStyle(
                            fontFamily = Muller,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = DeleteText,
                        ),
                    )
                }
                // Сохранить
                val canSave = name.isNotBlank()
                Box(
                    modifier = Modifier
                        .weight(2f)
                        .height(52.dp)
                        .clip(CircleShape)
                        .background(if (canSave) ValueColor else SaveDisabledBg)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            enabled = canSave,
                        ) {
                            val timeChangedByUser = time != initialTime || endTime != initialEnd
                            onSave(
                                task.copy(
                                    name = name.trim(),
                                    time = time,
                                    endTime = endTime.takeIf { it.isNotEmpty() },
                                    date = date,
                                    description = description.takeIf { it.isNotBlank() },
                                    location = location.takeIf { it.isNotBlank() },
                                    category = category,
                                    // Человек правил время руками → фиксируем источник как 'user'.
                                    timeSource = if (timeChangedByUser) "user" else task.timeSource,
                                    // Появилось реальное время — предложение агента больше не нужно.
                                    suggestedTime = if (time.isNotEmpty()) null else task.suggestedTime,
                                    suggestedEndTime = if (time.isNotEmpty()) null else task.suggestedEndTime,
                                ),
                            )
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "Сохранить",
                        style = TextStyle(
                            fontFamily = Muller,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White,
                        ),
                    )
                }
            }
            Box(Modifier.height(20.dp))
        }
    }
}

// ─── Детали ─────────────────────────────────────────────────────────────────

/** Контейнер поля — #F5F5F5, радиус 20, отступы 14/17 (FieldBox из веба). */
@Composable
private fun FieldBox(onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(FieldBg)
            .then(
                if (onClick != null) {
                    Modifier.clickable(
                        interactionSource = interaction,
                        indication = null,
                        onClick = onClick,
                    )
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 17.dp, vertical = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        content()
    }
}

/** Значение поля + иконка справа (часы/календарь). */
@Composable
private fun FieldValueWithIcon(value: String, placeholder: String, icon: ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = value.ifEmpty { placeholder },
            style = TextStyle(
                fontFamily = Muller,
                fontSize = 15.sp,
                fontWeight = if (value.isNotEmpty()) FontWeight.Medium else FontWeight.Normal,
                color = if (value.isNotEmpty()) ValueColor else PlaceholderColor,
            ),
            modifier = Modifier.weight(1f),
            maxLines = 1,
        )
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = Color.Unspecified,
            modifier = Modifier.size(20.dp).alpha(0.45f),
        )
    }
}

// ─── Иконки полей (порт data-URI SVG из EditTaskModal.tsx) ──────────────────

/** Часы — поля времени. */
private val TaskTimeIconVector: ImageVector = ImageVector.Builder(
    name = "TaskTime",
    defaultWidth = 20.dp,
    defaultHeight = 20.dp,
    viewportWidth = 55f,
    viewportHeight = 55f,
).addPath(
    pathData = addPathNodes(
        "M27.5 2.75C41.169 2.75 52.25 13.831 52.25 27.5C52.25 41.169 41.169 52.25 27.5 " +
            "52.25C13.831 52.25 2.75 41.169 2.75 27.5C2.75 13.831 13.831 2.75 27.5 2.75Z",
    ),
    stroke = SolidColor(IconTint),
    strokeLineWidth = 5.5f,
).addPath(
    pathData = addPathNodes("M27.5 15.7812L27.5 28.0035"),
    stroke = SolidColor(IconTint),
    strokeLineWidth = 5.5f,
    strokeLineCap = StrokeCap.Round,
).addPath(
    pathData = addPathNodes("M27.5 28.6094L37.2216 38.331"),
    stroke = SolidColor(IconTint),
    strokeLineWidth = 5.5f,
    strokeLineCap = StrokeCap.Round,
).build()

/** Календарь — поле даты. */
private val TaskDateIconVector: ImageVector = ImageVector.Builder(
    name = "TaskDate",
    defaultWidth = 20.dp,
    defaultHeight = 20.dp,
    viewportWidth = 50f,
    viewportHeight = 56f,
).addPath(
    pathData = addPathNodes(
        "M34.375 0C35.8938 2.06051e-08 37.125 1.23122 37.125 2.75V6.74414C44.0268 8.60239 " +
            "49.1073 14.9039 49.1074 22.3926V39.0889L49.1016 39.5078C48.8829 48.1251 41.9376 " +
            "55.0706 33.3203 55.2891L32.9014 55.2949H16.2051L15.7871 55.2891C7.0306 55.0672 " +
            "0.000257744 47.8988 0 39.0889V22.3926C0.000117721 15.0824 4.84063 8.90273 " +
            "11.4912 6.88379V2.75C11.4912 1.23122 12.7224 5.61746e-08 14.2412 0C15.7599 " +
            "7.52798e-05 16.9912 1.23126 16.9912 2.75V6.1875H31.625V2.75C31.625 1.23122 " +
            "32.8562 5.61746e-08 34.375 0ZM5.5 39.0889C5.50026 45.001 10.293 49.7948 16.2051 " +
            "49.7949H32.9014C38.8136 49.7949 43.6072 45.001 43.6074 39.0889V23.1777H5.5V" +
            "39.0889ZM16.2051 11.6875C11.9849 11.6876 8.33625 14.1297 6.59277 17.6777H" +
            "42.5146C40.7709 14.1296 37.1217 11.6875 32.9014 11.6875H16.2051Z",
    ),
    fill = SolidColor(IconTint),
).build()

/** Точка на карте — поле места. */
private val TaskPlaceIconVector: ImageVector = ImageVector.Builder(
    name = "TaskPlace",
    defaultWidth = 20.dp,
    defaultHeight = 20.dp,
    viewportWidth = 45f,
    viewportHeight = 55f,
).addPath(
    pathData = addPathNodes(
        "M2.75 21.865C2.75 35.2617 14.4696 46.3401 19.6571 50.5875C20.3995 51.1954 20.7751 " +
            "51.503 21.329 51.6589C21.7603 51.7804 22.395 51.7804 22.8263 51.6589C23.3812 " +
            "51.5027 23.7543 51.1981 24.4995 50.588C29.6869 46.3405 41.4059 35.2629 41.4059 " +
            "21.8663C41.4059 16.7965 39.3697 11.9337 35.745 8.34885C32.1202 4.76397 27.2044 " +
            "2.75 22.0783 2.75C16.9522 2.75 12.0358 4.76427 8.41106 8.34915C4.78634 11.934 " +
            "2.75 16.7953 2.75 21.865Z",
    ),
    stroke = SolidColor(IconTint),
    strokeLineWidth = 5.5f,
    strokeLineCap = StrokeCap.Round,
    strokeLineJoin = StrokeJoin.Round,
).addPath(
    pathData = addPathNodes(
        "M15.5786 20.7098C15.5786 24.3238 18.5621 27.2536 22.2424 27.2536C25.9227 27.2536 " +
            "28.9061 24.3238 28.9061 20.7098C28.9061 17.0958 25.9227 14.166 22.2424 " +
            "14.166C18.5621 14.166 15.5786 17.0958 15.5786 20.7098Z",
    ),
    stroke = SolidColor(IconTint),
    strokeLineWidth = 5.5f,
    strokeLineCap = StrokeCap.Round,
    strokeLineJoin = StrokeJoin.Round,
).build()

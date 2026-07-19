package ru.mindex.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.mindex.app.data.model.Task
import ru.mindex.app.ui.theme.Muller

// Цвета — 1:1 с src/components/TaskItem.tsx
private val CheckboxBorderIdle = Color(0x40222224)   // rgba(34,34,36,0.25)
private val CheckboxDone = Color(0xFF222224)
private val TextDone = Color(0x59222224)             // rgba(34,34,36,0.35)
private val TextActive = Color(0xFF222224)
private val TimeColor = Color(0x66222224)            // rgba(34,34,36,0.4)
private val ChevronColor = Color(0x59222224)         // rgba(34,34,36,0.35)

/**
 * Строка задачи — порт src/components/TaskItem.tsx.
 *
 * Отметка выполнения — момент удовлетворения: чекбокс «выпрыгивает»
 * пружинной анимацией, текст плавно гаснет и зачёркивается.
 *
 * @param onToggleSubtask null — подзадачи показываются, но не переключаются.
 */
@Composable
fun TaskItem(
    task: Task,
    onToggle: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onToggleSubtask: ((taskId: String, subtaskId: String) -> Unit)? = null,
) {
    var isExpanded by remember { mutableStateOf(false) }
    val subtasks = task.subtasks.orEmpty()
    val hasSubtasks = subtasks.isNotEmpty()

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onClick,
                )
                .padding(vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TaskCheckbox(done = task.done, size = 26.dp, onToggle = onToggle)

            // Название — гаснет и зачёркивается при выполнении
            val nameColor by animateColorAsState(
                targetValue = if (task.done) TextDone else TextActive,
                animationSpec = tween(150),
                label = "taskNameColor",
            )
            Text(
                text = task.name,
                modifier = Modifier.weight(1f),
                style = TextStyle(
                    fontFamily = Muller,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Normal,
                    color = nameColor,
                    textDecoration = if (task.done) TextDecoration.LineThrough else TextDecoration.None,
                ),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )

            // Время (и диапазон, если есть конец)
            if (task.time.isNotEmpty()) {
                Text(
                    text = task.time + (task.endTime?.takeIf { it.isNotEmpty() }?.let { " – $it" } ?: ""),
                    style = TextStyle(fontFamily = Muller, fontSize = 14.sp, color = TimeColor),
                )
            }

            // Разворот подзадач
            if (hasSubtasks) {
                val rotation by animateFloatAsState(
                    targetValue = if (isExpanded) 180f else 0f,
                    animationSpec = tween(200),
                    label = "chevronRotation",
                )
                Box(
                    modifier = Modifier
                        .size(16.dp)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { isExpanded = !isExpanded },
                    contentAlignment = Alignment.Center,
                ) {
                    ChevronDownIcon(
                        color = ChevronColor,
                        modifier = Modifier.size(16.dp).rotate(rotation),
                    )
                }
            }
        }

        // Раскрывающийся список подзадач
        AnimatedVisibility(
            visible = isExpanded && hasSubtasks,
            enter = expandVertically(tween(200)) + fadeIn(tween(200)),
            exit = shrinkVertically(tween(200)) + fadeOut(tween(200)),
        ) {
            Column(
                modifier = Modifier.padding(start = 38.dp, bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                subtasks.forEach { st ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                enabled = onToggleSubtask != null,
                            ) { onToggleSubtask?.invoke(task.id, st.id) }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        TaskCheckbox(
                            done = st.done,
                            size = 18.dp,
                            onToggle = { onToggleSubtask?.invoke(task.id, st.id) },
                        )
                        Text(
                            text = st.name,
                            style = TextStyle(
                                fontFamily = Muller,
                                fontSize = 13.sp,
                                color = if (st.done) TextDone else TextActive,
                                textDecoration = if (st.done) TextDecoration.LineThrough else TextDecoration.None,
                            ),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Круглый чекбокс задачи с «пружинной» галочкой.
 * Заливка плавно проявляется, галочка выпрыгивает spring-анимацией.
 */
@Composable
private fun TaskCheckbox(
    done: Boolean,
    size: androidx.compose.ui.unit.Dp,
    onToggle: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val pressScale by animateFloatAsState(
        targetValue = if (pressed) 0.85f else 1f,
        animationSpec = spring(stiffness = Spring.StiffnessMedium),
        label = "checkboxPressScale",
    )
    val fill by animateColorAsState(
        targetValue = if (done) CheckboxDone else Color.Transparent,
        animationSpec = tween(150),
        label = "checkboxFill",
    )
    val borderColor by animateColorAsState(
        targetValue = if (done) CheckboxDone else CheckboxBorderIdle,
        animationSpec = tween(150),
        label = "checkboxBorder",
    )
    val checkScale by animateFloatAsState(
        targetValue = if (done) 1f else 0f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessMediumLow,
        ),
        label = "checkScale",
    )

    Box(
        modifier = Modifier
            .size(size)
            .graphicsLayer { scaleX = pressScale; scaleY = pressScale }
            .clip(CircleShape)
            .background(fill)
            .border(1.5.dp, borderColor, CircleShape)
            .clickable(interactionSource = interaction, indication = null, onClick = onToggle),
        contentAlignment = Alignment.Center,
    ) {
        if (checkScale > 0.01f) {
            Canvas(
                modifier = Modifier
                    .size(size * 0.45f)
                    .graphicsLayer { scaleX = checkScale; scaleY = checkScale },
            ) {
                // Геометрия lucide Check ("M20 6 9 17l-5-5"), strokeWidth 2.5/24.
                val w = this.size.width
                val h = this.size.height
                val path = Path().apply {
                    moveTo(w * 0.167f, h * 0.5f)
                    lineTo(w * 0.375f, h * 0.708f)
                    lineTo(w * 0.833f, h * 0.25f)
                }
                drawPath(
                    path = path,
                    color = Color.White,
                    style = Stroke(
                        width = w * 0.104f,
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round,
                    ),
                )
            }
        }
    }
}

/** Шеврон вниз (16dp, stroke) — раскрытие подзадач. */
@Composable
private fun ChevronDownIcon(color: Color, modifier: Modifier = Modifier) {
    // Геометрия lucide ChevronDown ("m6 9 6 6 6-6"), strokeWidth 2/24.
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val stroke = Stroke(width = w * 0.083f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val path = Path().apply {
            moveTo(w * 0.25f, h * 0.375f)
            lineTo(w * 0.5f, h * 0.625f)
            lineTo(w * 0.75f, h * 0.375f)
        }
        drawPath(path = path, color = color, style = stroke)
    }
}

/** Публичная утилита: галочка для повторного использования (например, в мини-списках). */
@Composable
fun TaskCheckMark(color: Color, modifier: Modifier = Modifier) {
    // Геометрия lucide Check ("M20 6 9 17l-5-5"), strokeWidth 2.5/24.
    Canvas(modifier = modifier) {
        val path = Path().apply {
            moveTo(size.width * 0.167f, size.height * 0.5f)
            lineTo(size.width * 0.375f, size.height * 0.708f)
            lineTo(size.width * 0.833f, size.height * 0.25f)
        }
        drawPath(
            path = path,
            color = color,
            style = Stroke(width = size.width * 0.104f, cap = StrokeCap.Round, join = StrokeJoin.Round),
        )
    }
}

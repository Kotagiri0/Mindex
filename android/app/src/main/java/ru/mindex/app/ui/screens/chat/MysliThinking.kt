package ru.mindex.app.ui.screens.chat

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Индикатор «Мысль думает» — порт MysliThinking.tsx и CSS-анимаций
 * `.mysli-thinking` из src/index.css: пульсирующий внешний круг,
 * две встречно вращающиеся орбиты, «зрачок»-дыхание и мигающая
 * точка в центре. Геометрия 1:1 с исходным SVG (viewBox 48×48).
 */
@Composable
fun MysliThinking(
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
    color: Color = Color(0xFF111111),
) {
    val transition = rememberInfiniteTransition(label = "mysliThinking")

    // outerPulse: 1.4s ease-in-out, туда-обратно (0% → 50% → 100%).
    val pulse by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 700, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "outerPulse",
    )

    // ellipseRotate: 1.8s linear, 0° → 360°.
    val rotation1 by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1800, easing = LinearEasing),
        ),
        label = "ellipseRotate",
    )

    // ellipseRotate2: 2.2s linear, в обратную сторону.
    val rotation2 by transition.animateFloat(
        initialValue = 0f,
        targetValue = -360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2200, easing = LinearEasing),
        ),
        label = "ellipseRotate2",
    )

    // pupilBreath: 1.4s ease-in-out, scale 1 → 0.85, opacity 1 → 0.7.
    val breath by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 700, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pupilBreath",
    )

    // dotBlink: 1.4s ease-in-out, opacity 1 → 0.4.
    val blink by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.4f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 700, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "dotBlink",
    )

    Canvas(modifier.size(size)) {
        val s = this.size.minDimension / 48f
        val c = center

        // Внешний круг r=20, stroke 2.5.
        scale(scale = 1f - 0.04f * pulse, pivot = c) {
            drawCircle(
                color = color.copy(alpha = 1f - 0.4f * pulse),
                radius = 20f * s,
                center = c,
                style = Stroke(width = 2.5f * s),
            )
        }

        // Орбита 1: rx=20, ry=9, stroke 1.8.
        rotate(degrees = rotation1, pivot = c) {
            drawOval(
                color = color,
                topLeft = Offset(c.x - 20f * s, c.y - 9f * s),
                size = Size(40f * s, 18f * s),
                style = Stroke(width = 1.8f * s),
            )
        }

        // Орбита 2: rx=20, ry=5, stroke 1.2, opacity 0.4.
        rotate(degrees = rotation2, pivot = c) {
            drawOval(
                color = color.copy(alpha = 0.4f),
                topLeft = Offset(c.x - 20f * s, c.y - 5f * s),
                size = Size(40f * s, 10f * s),
                style = Stroke(width = 1.2f * s),
            )
        }

        // «Зрачок» r=6, stroke 2.
        scale(scale = 1f - 0.15f * breath, pivot = c) {
            drawCircle(
                color = color.copy(alpha = 1f - 0.3f * breath),
                radius = 6f * s,
                center = c,
                style = Stroke(width = 2f * s),
            )
        }

        // Центральная точка r=2, filled.
        drawCircle(
            color = color.copy(alpha = blink),
            radius = 2f * s,
            center = c,
        )
    }
}

package ru.mindex.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val LightColors = lightColorScheme(
    primary = MindexColors.Accent,
    onPrimary = MindexColors.AccentText,
    background = MindexColors.Bg,
    onBackground = MindexColors.TextPrimary,
    surface = MindexColors.Surface,
    onSurface = MindexColors.TextPrimary,
    surfaceVariant = MindexColors.Surface2,
    onSurfaceVariant = MindexColors.TextMuted,
    outline = MindexColors.Border,
    error = MindexColors.Danger,
    // Меню и диалоги в вебе — чисто белые, без M3-тонирования.
    surfaceTint = MindexColors.Surface,
    surfaceContainerLowest = MindexColors.Surface,
    surfaceContainerLow = MindexColors.Surface,
    surfaceContainer = MindexColors.Surface,
    surfaceContainerHigh = MindexColors.Surface,
    surfaceContainerHighest = MindexColors.Surface,
)

/** Радиусы — единая система из DESIGN.md: 8/12/16/20/24/40px. */
private val MindexShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

private val MindexTypography = Typography(
    // Крупный заголовок экрана («ПЯТНИЦА», «настройки», «есть мысли?»)
    displaySmall = TextStyle(
        fontFamily = RandomGrotesque,
        fontWeight = FontWeight.Normal,
        fontSize = 32.sp,
        color = MindexColors.Text80,
    ),
    headlineSmall = TextStyle(
        fontFamily = RandomGrotesque,
        fontWeight = FontWeight.Normal,
        fontSize = 24.sp,
        color = MindexColors.Text80,
    ),
    // Заголовок секции — Muller Medium 15
    titleMedium = TextStyle(
        fontFamily = Muller,
        fontWeight = FontWeight.Medium,
        fontSize = 15.sp,
        color = MindexColors.TextPrimary,
    ),
    // Название задачи / треда — Muller Medium 14–15
    titleSmall = TextStyle(
        fontFamily = Muller,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        color = MindexColors.TextPrimary,
    ),
    // Основной текст (ответы Мысли) — Muller Regular 15, line-height 1.7
    bodyLarge = TextStyle(
        fontFamily = Muller,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 25.sp,
        color = MindexColors.Text80,
    ),
    bodyMedium = TextStyle(
        fontFamily = Muller,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        color = MindexColors.TextPrimary,
    ),
    // Превью треда / вторичный текст — Muller Regular 13
    bodySmall = TextStyle(
        fontFamily = Muller,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        color = MindexColors.TextMuted,
    ),
    // Таб-кнопки, «ПОДКЛЮЧИТЬ»/«ВЫЙТИ» — Muller 11 SemiBold uppercase
    labelSmall = TextStyle(
        fontFamily = Muller,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        letterSpacing = 0.5.sp,
        color = MindexColors.TextPrimary,
    ),
    labelLarge = TextStyle(
        fontFamily = Muller,
        fontWeight = FontWeight.Medium,
        fontSize = 15.sp,
        color = MindexColors.TextPrimary,
    ),
)

@Composable
fun MindexTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LightColors,
        typography = MindexTypography,
        shapes = MindexShapes,
        content = content,
    )
}

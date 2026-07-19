package ru.mindex.app.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Дизайн-токены Mindex — 1:1 с :root в src/index.css.
 */
object MindexColors {
    val Bg = Color(0xFFF9F9F9)                    // --bg
    val Surface = Color(0xFFFFFFFF)               // --surface
    val Surface2 = Color(0xFFF2F2F2)              // --color-surface2
    val Border = Color(0x0D000000)                // rgba(0,0,0,0.05)
    val BorderInput = Color(0x1A000000)           // rgba(0,0,0,0.1)
    val TextPrimary = Color(0xFF222224)           // --text-primary
    val Text80 = Color(0xCC090E17)                // rgba(9,14,23,0.8)
    val Text40 = Color(0x66090E17)                // rgba(9,14,23,0.4)
    val Text30 = Color(0x4D090E17)                // rgba(9,14,23,0.3)
    val TextMuted = Color(0xCC656566)             // rgba(101,101,102,0.8)
    val TextUltra = Color(0x330B0D10)             // rgba(11,13,16,0.2)
    val Accent = Color(0xFF222224)                // --accent
    val AccentText = Color(0xFFF0F0F0)            // --accent-text
    val AccentLight = Color(0x14222224)           // rgba(34,34,36,0.08)
    val Danger = Color(0xFFC0392B)                // --color-danger
    val UserBubble = Color(0x12090E17)            // rgba(9,14,23,0.07) — пузырь пользователя (AIChat.tsx)
    val NavInactive = Color(0xFF9A9A9A)           // неактивная иконка нижней навигации
    val NavContainer = Color(0xFFECECEC)          // подложка нижней навигации
    val FabDark = Color(0xFF0B0D10)               // центральная FAB
    val SearchBg = Color(0x0A000000)              // rgba(0,0,0,0.04) — поле поиска

}

/** Цвета категории в таймлайне/календаре — 1:1 с src/lib/taskCategories.ts. */
data class CategoryColors(
    val bg: Color,
    val border: Color,
    val text: Color,
    val textMuted: Color,
)

object TaskCategoryPalette {
    val personal = CategoryColors(
        bg = Color(0xFFDDF3E4), border = Color(0xFFC2E6CE),
        text = Color(0xFF2F6B45), textMuted = Color(0x8C2F6B45),
    )
    val event = CategoryColors(
        bg = Color(0xFFDDE3F7), border = Color(0xFFC6D0EE),
        text = Color(0xFF3A4A86), textMuted = Color(0x8C3A4A86),
    )
    val study = CategoryColors(
        bg = Color(0xFFFBE7CF), border = Color(0xFFF3D6AE),
        text = Color(0xFF8A5A22), textMuted = Color(0x8C8A5A22),
    )
    val work = CategoryColors(
        bg = Color(0xFFF4DEDE), border = Color(0xFFE9C6C6),
        text = Color(0xFF8A3A3A), textMuted = Color(0x8C8A3A3A),
    )
    val none = CategoryColors(
        bg = Color(0xFFECECEC), border = Color(0xFFE0E0E0),
        text = Color(0xFF4A4A4C), textMuted = Color(0x804A4A4C),
    )

    val labels = mapOf(
        "work" to "Работа",
        "personal" to "Личное",
        "event" to "Мероприятие",
        "study" to "Учёба",
        "none" to "Без категории",
    )

    val ordered = listOf("work", "personal", "event", "study", "none")

    fun colors(category: String?): CategoryColors = when (category) {
        "work" -> work
        "personal" -> personal
        "event" -> event
        "study" -> study
        else -> none
    }
}

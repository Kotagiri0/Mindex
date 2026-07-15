package ru.mindex.app.ui.theme

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import ru.mindex.app.R

/**
 * Фирменные шрифты — те же ttf, что в src/assets/fonts веб-клиента.
 * Muller — основной; Random Grotesque — крупные заголовки
 * («есть мысли?», «ПЯТНИЦА»); Russisch Sans — дни недели в календаре.
 */
val Muller = FontFamily(
    Font(R.font.muller_regular, FontWeight.Normal),
    Font(R.font.muller_medium, FontWeight.Medium),
    Font(R.font.muller_bold, FontWeight.Bold),
)

val RandomGrotesque = FontFamily(
    Font(R.font.rg_spacious_book, FontWeight.Normal),
)

val RussischSans = FontFamily(
    Font(R.font.russisch_sans_semibold, FontWeight.SemiBold),
)

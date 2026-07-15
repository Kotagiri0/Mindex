package ru.mindex.app.ui.screens.settings

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.navigation.NavHostController
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.mindex.app.data.model.UserSettings
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.SessionState
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.RandomGrotesque

/**
 * Экран настроек — порт мобильной версии src/components/Settings.tsx.
 * Профиль → Инструкции → Интеграции → Данные и аккаунт + модалка
 * подтверждения очистки памяти.
 */

// rgba(0,0,0,0.06) — разделители секций, как в вебе
private val DividerColor = Color(0x0F000000)

// rgba(0,0,0,0.08) — рамка текстового поля
private val FieldBorder = Color(0x14000000)

// rgba(0,0,0,0.15) — рамка pill-кнопки
private val PillBorder = Color(0x26000000)

// rgba(220,60,60,0.3) — рамка danger pill-кнопки
private val PillBorderDanger = Color(0x4DDC3C3C)

@Composable
fun SettingsScreen(appViewModel: AppViewModel, navController: NavHostController) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val repo = appViewModel.container.dataRepository

    val profile by appViewModel.profile.collectAsState()
    val session by appViewModel.session.collectAsState()
    val user = (session as? SessionState.LoggedIn)?.user

    // Локальная копия настроек: сбрасывается один раз, когда профиль загрузился.
    val profileLoaded = profile != null
    var settings by remember(profileLoaded) { mutableStateOf(profile?.settings ?: UserSettings()) }
    var instructions by remember(profileLoaded) {
        mutableStateOf(profile?.settings?.instructions ?: "")
    }

    var showNameDialog by remember { mutableStateOf(false) }
    var nameDraft by remember { mutableStateOf("") }
    var confirmClear by remember { mutableStateOf(false) }

    val displayName = settings.name?.takeIf { it.isNotBlank() }
        ?: user?.displayName?.takeIf { it.isNotBlank() }
        ?: "Пользователь"
    val email = settings.email?.takeIf { it.isNotBlank() }
        ?: user?.email?.takeIf { it.isNotBlank() }
        ?: user?.username.orEmpty()

    fun persist(next: UserSettings) {
        settings = next
        scope.launch {
            repo.saveProfile(next, onboardingComplete = profile?.onboardingComplete ?: true)
        }
    }

    // Автосохранение инструкций с дебаунсом — как автосохранение в вебе.
    LaunchedEffect(instructions) {
        if (instructions != (settings.instructions ?: "")) {
            delay(600)
            persist(settings.copy(instructions = instructions))
        }
    }

    fun goBack() {
        // Досохраняем инструкции, если дебаунс не успел сработать.
        if (instructions != (settings.instructions ?: "")) {
            persist(settings.copy(instructions = instructions))
        }
        navController.popBackStack()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MindexColors.Bg)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(bottom = 60.dp),
    ) {
        // ─── Шапка ───────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { goBack() }, modifier = Modifier.size(38.dp)) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Назад",
                    tint = MindexColors.TextPrimary,
                    modifier = Modifier.size(22.dp),
                )
            }
            Text(
                text = "настройки",
                fontFamily = RandomGrotesque,
                fontSize = 22.sp,
                color = MindexColors.Text80,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(38.dp))
        }
        HorizontalDivider(thickness = 1.dp, color = DividerColor)
        Spacer(Modifier.height(24.dp))

        // ─── Профиль ─────────────────────────────────────────
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProfileAvatar(avatarUrl = settings.avatar ?: user?.avatarUrl)
            Spacer(Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = displayName,
                    fontFamily = Muller,
                    fontWeight = FontWeight.Medium,
                    fontSize = 16.sp,
                    color = MindexColors.TextPrimary,
                )
                if (email.isNotBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = email,
                        fontFamily = Muller,
                        fontSize = 13.sp,
                        color = MindexColors.TextMuted,
                    )
                }
            }
            IconButton(
                onClick = {
                    nameDraft = displayName
                    showNameDialog = true
                },
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    imageVector = Icons.Filled.Edit,
                    contentDescription = "Изменить имя",
                    tint = MindexColors.Text40,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
        Spacer(Modifier.height(20.dp))

        // ─── Инструкции ──────────────────────────────────────
        HorizontalDivider(thickness = 1.dp, color = DividerColor)
        Spacer(Modifier.height(16.dp))
        Text(
            text = "Инструкции",
            fontFamily = Muller,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = MindexColors.TextPrimary,
        )
        Spacer(Modifier.height(12.dp))
        InstructionsField(
            value = instructions,
            onValueChange = { instructions = it },
        )
        Spacer(Modifier.height(20.dp))

        // ─── Интеграции ──────────────────────────────────────
        HorizontalDivider(thickness = 1.dp, color = DividerColor)
        Spacer(Modifier.height(16.dp))
        Text(
            text = "Интеграции",
            fontFamily = Muller,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = MindexColors.TextPrimary,
        )
        Spacer(Modifier.height(4.dp))
        IntegrationRow(
            name = "Telegram",
            desc = "Уведомления о задачах прямо в Telegram",
            beta = true,
            onConnect = { Toast.makeText(context, "Скоро", Toast.LENGTH_SHORT).show() },
        )
        IntegrationRow(
            name = "Google Календарь + Meet",
            desc = "Синхронизация событий и задач",
            onConnect = { Toast.makeText(context, "Скоро", Toast.LENGTH_SHORT).show() },
        )
        Spacer(Modifier.height(8.dp))

        // ─── Данные и аккаунт ────────────────────────────────
        HorizontalDivider(thickness = 1.dp, color = DividerColor)
        Spacer(Modifier.height(16.dp))
        Text(
            text = "Данные и аккаунт",
            fontFamily = Muller,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = MindexColors.TextPrimary,
        )
        Spacer(Modifier.height(4.dp))
        AccountRow(
            label = "Выйти из аккаунта",
            action = "Выйти",
            onAction = { appViewModel.logout() },
        )
        AccountRow(
            label = "Память модели",
            action = "Очистить",
            danger = true,
            onAction = { confirmClear = true },
        )
    }

    // ─── Модалка «Очистить память?» ──────────────────────────
    if (confirmClear) {
        ConfirmModal(
            title = "Очистить память?",
            body = "Мысль забудет все переписки и накопленный контекст. Задачи и аккаунт останутся. Восстановить нельзя.",
            confirmLabel = "Очистить память",
            onConfirm = {
                repo.clearMemory()
                confirmClear = false
            },
            onDismiss = { confirmClear = false },
        )
    }

    // ─── Диалог редактирования имени ─────────────────────────
    if (showNameDialog) {
        Dialog(onDismissRequest = { showNameDialog = false }) {
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = MindexColors.Surface,
                modifier = Modifier.widthIn(max = 340.dp).fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(32.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text(
                        text = "Как тебя зовут?",
                        fontFamily = Muller,
                        fontWeight = FontWeight.Medium,
                        fontSize = 18.sp,
                        color = MindexColors.TextPrimary,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    BasicTextField(
                        value = nameDraft,
                        onValueChange = { nameDraft = it },
                        singleLine = true,
                        textStyle = TextStyle(
                            fontFamily = Muller,
                            fontSize = 14.sp,
                            color = MindexColors.TextPrimary,
                        ),
                        cursorBrush = SolidColor(MindexColors.Accent),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(MindexColors.Surface)
                            .border(1.dp, FieldBorder, RoundedCornerShape(12.dp))
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                persist(settings.copy(name = nameDraft.trim()))
                                showNameDialog = false
                            },
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MindexColors.Accent,
                                contentColor = MindexColors.AccentText,
                            ),
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                        ) {
                            Text(
                                "Сохранить",
                                fontFamily = Muller,
                                fontWeight = FontWeight.Medium,
                                fontSize = 14.sp,
                            )
                        }
                        OutlinedButton(
                            onClick = { showNameDialog = false },
                            shape = CircleShape,
                            border = BorderStroke(1.dp, MindexColors.BorderInput),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = MindexColors.TextPrimary,
                            ),
                            modifier = Modifier.fillMaxWidth().height(44.dp),
                        ) {
                            Text("Отмена", fontFamily = Muller, fontSize = 14.sp)
                        }
                    }
                }
            }
        }
    }
}

// ─── Компоненты ──────────────────────────────────────────────

/** Аватар: картинка через Coil или фирменный логотип «м» из SVG веб-версии. */
@Composable
private fun ProfileAvatar(avatarUrl: String?) {
    if (!avatarUrl.isNullOrBlank()) {
        AsyncImage(
            model = avatarUrl,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(48.dp).clip(CircleShape),
        )
    } else {
        // Точная отрисовка SVG-заглушки из Settings.tsx (viewBox 125×125)
        Canvas(modifier = Modifier.size(48.dp)) {
            val s = size.minDimension / 125f
            val white = Color(0xFFFEFEFE)
            drawCircle(color = Color(0xFF222224), radius = 62.5f * s, center = center)
            drawRoundRect(
                color = white,
                topLeft = Offset(29.45f * s, 30.45f * s),
                size = Size(65.1f * s, 65.1f * s),
                cornerRadius = CornerRadius(32.55f * s, 32.55f * s),
                style = Stroke(width = 4.9f * s),
            )
            drawLine(
                color = white,
                start = Offset(77f * s, 51f * s),
                end = Offset(77f * s, 68f * s),
                strokeWidth = 4.9f * s,
            )
            drawLine(
                color = white,
                start = Offset(65f * s, 51f * s),
                end = Offset(65f * s, 68f * s),
                strokeWidth = 4.9f * s,
            )
        }
    }
}

/** Поле «Инструкции» — стилизовано под textarea веба (радиус 16, тонкая рамка). */
@Composable
private fun InstructionsField(value: String, onValueChange: (String) -> Unit) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle = TextStyle(
            fontFamily = Muller,
            fontSize = 14.sp,
            lineHeight = 22.sp,
            color = MindexColors.TextPrimary,
        ),
        cursorBrush = SolidColor(MindexColors.Accent),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 100.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MindexColors.Surface)
            .border(1.dp, FieldBorder, RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) {
                    Text(
                        text = "Опиши, как ты хочешь, чтобы ии с тобой общался",
                        fontFamily = Muller,
                        fontSize = 14.sp,
                        lineHeight = 22.sp,
                        color = MindexColors.Text30,
                    )
                }
                inner()
            }
        },
    )
}

/** Pill-кнопка «ПОДКЛЮЧИТЬ» / «ВЫЙТИ» / «ОЧИСТИТЬ» — как PillButton веба. */
@Composable
private fun PillButton(label: String, danger: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .border(1.dp, if (danger) PillBorderDanger else PillBorder, CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label.uppercase(),
            fontFamily = Muller,
            fontSize = 11.sp,
            letterSpacing = 0.88.sp,
            color = if (danger) MindexColors.Danger else MindexColors.TextPrimary,
            maxLines = 1,
        )
    }
}

/** Строка интеграции: название + описание слева, pill «Подключить» справа. */
@Composable
private fun IntegrationRow(
    name: String,
    desc: String,
    beta: Boolean = false,
    onConnect: () -> Unit,
) {
    Column {
        HorizontalDivider(thickness = 1.dp, color = DividerColor)
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = name,
                        fontFamily = Muller,
                        fontSize = 15.sp,
                        color = MindexColors.TextPrimary,
                    )
                    if (beta) {
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "бета".uppercase(),
                            fontFamily = Muller,
                            fontWeight = FontWeight.Medium,
                            fontSize = 10.sp,
                            letterSpacing = 0.6.sp,
                            color = Color(0xE6787878),
                            modifier = Modifier
                                .clip(RoundedCornerShape(20.dp))
                                .background(Color(0x1F787878))
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                        )
                    }
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    text = desc,
                    fontFamily = Muller,
                    fontSize = 13.sp,
                    color = MindexColors.TextMuted,
                )
            }
            PillButton(label = "Подключить", onClick = onConnect)
        }
    }
}

/** Строка секции «Данные и аккаунт»: подпись слева, pill-действие справа. */
@Composable
private fun AccountRow(
    label: String,
    action: String,
    danger: Boolean = false,
    onAction: () -> Unit,
) {
    Column {
        HorizontalDivider(thickness = 1.dp, color = DividerColor)
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                fontFamily = Muller,
                fontSize = 15.sp,
                color = MindexColors.TextPrimary,
                modifier = Modifier.weight(1f).padding(end = 12.dp),
            )
            PillButton(label = action, danger = danger, onClick = onAction)
        }
    }
}

/** Модалка подтверждения — карточка 20dp, danger-кнопка и «Отмена», как в вебе. */
@Composable
private fun ConfirmModal(
    title: String,
    body: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MindexColors.Surface,
            modifier = Modifier.widthIn(max = 340.dp).fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(32.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    text = title,
                    fontFamily = Muller,
                    fontWeight = FontWeight.Medium,
                    fontSize = 18.sp,
                    color = MindexColors.TextPrimary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    text = body,
                    fontFamily = Muller,
                    fontSize = 14.sp,
                    lineHeight = 22.sp,
                    color = MindexColors.TextMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = onConfirm,
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MindexColors.Danger,
                            contentColor = Color.White,
                        ),
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                    ) {
                        Text(
                            text = confirmLabel,
                            fontFamily = Muller,
                            fontWeight = FontWeight.Medium,
                            fontSize = 14.sp,
                        )
                    }
                    OutlinedButton(
                        onClick = onDismiss,
                        shape = CircleShape,
                        border = BorderStroke(1.dp, MindexColors.BorderInput),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MindexColors.TextPrimary,
                        ),
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                    ) {
                        Text("Отмена", fontFamily = Muller, fontSize = 14.sp)
                    }
                }
            }
        }
    }
}

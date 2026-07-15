package ru.mindex.app.ui.screens.threads

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import kotlinx.coroutines.launch
import ru.mindex.app.data.model.Thread
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.components.BottomNav
import ru.mindex.app.ui.navigation.Routes
import ru.mindex.app.ui.theme.Muller
import ru.mindex.app.ui.theme.RandomGrotesque
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// Цвета — 1:1 с src/components/Threads.tsx
private val ThoughtsBg = Color(0xFFFFFFFF)
private val NotesBg = Color(0xFFF0F0F0)
private val TabSliderBg = Color(0xFFE8E8E8)
private val TabActiveText = Color(0xFF111111)
private val TabInactiveText = Color(0x73222224)   // rgba(34,34,36,0.45)
private val IconDark = Color(0xFF111111)
private val SearchBorder = Color(0x1A222224)      // rgba(34,34,36,0.1)
private val SearchIconTint = Color(0x4D222224)    // rgba(34,34,36,0.3)
private val EmptyStateColor = Color(0x4D222224)   // rgba(34,34,36,0.3)
private val TitleColor = Color(0xFF111111)
private val PreviewColor = Color(0xFFAAAAAA)
private val NotePreviewColor = Color(0x66222224)  // rgba(34,34,36,0.4)
private val NoteDateColor = Color(0x4D222224)     // rgba(34,34,36,0.3)
private val MoreTint = Color(0x59222224)          // rgba(34,34,36,0.35)
private val DividerColor = Color(0x0D000000)      // rgba(0,0,0,0.05)
private val RenameUnderline = Color(0x33000000)   // rgba(0,0,0,0.2)
private val DeleteRed = Color(0xFFE53E3E)

/** Дата заметки — как toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }). */
private val NoteDateFormat = DateTimeFormatter.ofPattern("d MMM", Locale("ru"))

/**
 * Экран «Твои мысли | Заметки» — порт src/components/Threads.tsx.
 *
 * Две вкладки: «Мысли» (список тредов) и «Заметки» (сетка карточек 2×N).
 * Поиск — локальный по названию и превью; переименование — инлайн;
 * удаление — через выпадающее меню строки.
 */
@Composable
fun ThreadsScreen(appViewModel: AppViewModel, navController: NavHostController) {
    val scope = rememberCoroutineScope()
    val repo = appViewModel.container.dataRepository
    val threads by appViewModel.threads.collectAsState()

    var activeTab by rememberSaveable { mutableStateOf("thoughts") }
    var search by rememberSaveable { mutableStateOf("") }
    var showSearch by rememberSaveable { mutableStateOf(false) }
    var openDropdownId by remember { mutableStateOf<String?>(null) }
    var renamingId by remember { mutableStateOf<String?>(null) }
    var renameValue by remember { mutableStateOf("") }

    // Фильтрация — 1:1 с Threads.tsx (isNoteThread + searchMatch)
    val filtered = remember(threads, activeTab, search) {
        val query = search.trim()
        fun searchMatch(t: Thread): Boolean =
            query.isEmpty() ||
                t.title.contains(query, ignoreCase = true) ||
                t.preview.contains(query, ignoreCase = true)

        fun isNoteThread(t: Thread): Boolean =
            t.source != "skill" &&
                (t.source == "заметка" || (!t.summary.isNullOrBlank() && t.isMeaningful != false))

        threads.filter { t ->
            when {
                t.source == "skill" -> false
                activeTab == "thoughts" -> t.source != "заметка" && searchMatch(t)
                else -> isNoteThread(t) && searchMatch(t)
            }
        }.sortedByDescending { it.updatedAt ?: it.createdAt }
    }

    fun handleRename(id: String) {
        val value = renameValue.trim()
        renamingId = null
        if (value.isEmpty()) return
        threads.firstOrNull { it.id == id }?.let { t ->
            scope.launch { repo.upsertThread(t.copy(title = value)) }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(if (activeTab == "thoughts") ThoughtsBg else NotesBg),
    ) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding()) {

            // ─── Шапка: поиск, таб-слайдер, «+»/настройки ───────
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                HeaderIconButton(onClick = {
                    if (showSearch) search = ""
                    showSearch = !showSearch
                }) {
                    SearchIcon(color = IconDark, modifier = Modifier.size(24.dp))
                }

                // Таб-слайдер «Мысли | Заметки»
                Row(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(TabSliderBg)
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    TabPill(
                        label = "Мысли",
                        active = activeTab == "thoughts",
                        onClick = { activeTab = "thoughts" },
                    )
                    TabPill(
                        label = "Заметки",
                        active = activeTab == "notes",
                        onClick = { activeTab = "notes" },
                    )
                }

                if (activeTab == "notes") {
                    HeaderIconButton(onClick = { navController.navigate(Routes.note("new")) }) {
                        PlusIcon(color = IconDark, modifier = Modifier.size(24.dp))
                    }
                } else {
                    HeaderIconButton(onClick = { navController.navigate(Routes.SETTINGS) }) {
                        Icon(
                            imageVector = SettingsIconVector,
                            contentDescription = "Настройки",
                            tint = IconDark,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }

            // ─── Строка поиска ───────────────────────────────────
            AnimatedVisibility(
                visible = showSearch,
                enter = expandVertically(tween(200)) + fadeIn(tween(200)),
                exit = shrinkVertically(tween(200)) + fadeOut(tween(200)),
            ) {
                Row(
                    modifier = Modifier
                        .padding(start = 20.dp, end = 20.dp, bottom = 8.dp)
                        .fillMaxWidth()
                        .height(44.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                        .border(1.dp, SearchBorder, CircleShape)
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    SearchIcon(color = SearchIconTint, modifier = Modifier.size(15.dp))
                    BasicTextField(
                        value = search,
                        onValueChange = { search = it },
                        singleLine = true,
                        textStyle = TextStyle(
                            fontFamily = Muller,
                            fontSize = 15.sp,
                            color = Color(0xFF222224),
                        ),
                        cursorBrush = SolidColor(Color(0xFF222224)),
                        modifier = Modifier.weight(1f),
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (search.isEmpty()) {
                                    Text(
                                        text = if (activeTab == "thoughts") "Поиск по мыслям..." else "Поиск по заметкам...",
                                        style = TextStyle(
                                            fontFamily = Muller,
                                            fontSize = 15.sp,
                                            color = SearchIconTint,
                                        ),
                                    )
                                }
                                inner()
                            }
                        },
                    )
                }
            }

            // Разделитель под шапкой
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .height(1.dp)
                    .background(DividerColor),
            )

            // ─── Контент вкладки ─────────────────────────────────
            if (activeTab == "notes") {
                if (filtered.isEmpty()) {
                    EmptyState("Нет заметок. Начни мысль или нажми +")
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 140.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        gridItems(filtered, key = { it.id }) { th ->
                            NoteCard(
                                thread = th,
                                onClick = { navController.navigate(Routes.note(th.id)) },
                            )
                        }
                    }
                }
            } else {
                if (filtered.isEmpty()) {
                    EmptyState("Нет мыслей. Начни новую!")
                } else {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(bottom = 140.dp),
                    ) {
                        items(filtered, key = { it.id }) { th ->
                            ThreadRow(
                                thread = th,
                                isRenaming = renamingId == th.id,
                                renameValue = renameValue,
                                onRenameValueChange = { renameValue = it },
                                onRenameCommit = { handleRename(th.id) },
                                dropdownOpen = openDropdownId == th.id,
                                onDropdownToggle = {
                                    openDropdownId = if (openDropdownId == th.id) null else th.id
                                },
                                onDropdownDismiss = { openDropdownId = null },
                                onRenameStart = {
                                    openDropdownId = null
                                    renameValue = th.title
                                    renamingId = th.id
                                },
                                onDelete = {
                                    openDropdownId = null
                                    scope.launch { repo.deleteThread(th.id) }
                                },
                                onClick = {
                                    if (openDropdownId == null && renamingId != th.id) {
                                        navController.navigate(Routes.chat(th.id))
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }

        // ─── Нижняя навигация ────────────────────────────────────
        Box(modifier = Modifier.align(Alignment.BottomCenter)) {
            BottomNav(navController = navController, current = Routes.THREADS)
        }
    }
}

// ─── Элементы списка ────────────────────────────────────────────────────────

/** Строка треда во вкладке «Мысли»: название, превью, меню «⋮». */
@Composable
private fun ThreadRow(
    thread: Thread,
    isRenaming: Boolean,
    renameValue: String,
    onRenameValueChange: (String) -> Unit,
    onRenameCommit: () -> Unit,
    dropdownOpen: Boolean,
    onDropdownToggle: () -> Unit,
    onDropdownDismiss: () -> Unit,
    onRenameStart: () -> Unit,
    onDelete: () -> Unit,
    onClick: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onClick,
                )
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(end = 8.dp),
            ) {
                if (isRenaming) {
                    val focusRequester = remember { FocusRequester() }
                    LaunchedEffect(Unit) { focusRequester.requestFocus() }
                    BasicTextField(
                        value = renameValue,
                        onValueChange = onRenameValueChange,
                        singleLine = true,
                        textStyle = TextStyle(
                            fontFamily = Muller,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            color = TitleColor,
                        ),
                        cursorBrush = SolidColor(Color(0xFF222224)),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { onRenameCommit() }),
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(focusRequester)
                            .padding(bottom = 3.dp),
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(RenameUnderline),
                    )
                } else {
                    Text(
                        text = thread.title,
                        style = TextStyle(
                            fontFamily = Muller,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            color = TitleColor,
                        ),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(bottom = 3.dp),
                    )
                }
                Text(
                    text = thread.preview.ifEmpty { "Нет сообщений" },
                    style = TextStyle(
                        fontFamily = Muller,
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                        color = PreviewColor,
                    ),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            // Меню «⋮»: переименовать / удалить
            Box {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = onDropdownToggle,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    MoreVerticalIcon(color = MoreTint, modifier = Modifier.size(18.dp))
                }
                DropdownMenu(
                    expanded = dropdownOpen,
                    onDismissRequest = onDropdownDismiss,
                ) {
                    DropdownMenuItem(
                        text = {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                PencilIcon(color = TitleColor, modifier = Modifier.size(13.dp))
                                Text(
                                    text = "Переименовать",
                                    style = TextStyle(fontFamily = Muller, fontSize = 14.sp, color = TitleColor),
                                )
                            }
                        },
                        onClick = onRenameStart,
                    )
                    DropdownMenuItem(
                        text = {
                            Text(
                                text = "Удалить",
                                style = TextStyle(fontFamily = Muller, fontSize = 14.sp, color = DeleteRed),
                            )
                        },
                        onClick = onDelete,
                    )
                }
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(DividerColor),
        )
    }
}

/** Карточка заметки в сетке 2×N: заголовок, превью, короткая дата. */
@Composable
private fun NoteCard(thread: Thread, onClick: () -> Unit) {
    val dateStr = remember(thread.createdAt) {
        Instant.ofEpochMilli(thread.createdAt)
            .atZone(ZoneId.systemDefault())
            .toLocalDate()
            .format(NoteDateFormat)
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 100.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(start = 14.dp, top = 14.dp, end = 14.dp, bottom = 12.dp),
    ) {
        Column(
            modifier = Modifier.padding(bottom = 22.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = thread.title,
                style = TextStyle(
                    fontFamily = Muller,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    lineHeight = 17.sp,
                    color = TitleColor,
                ),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (thread.preview.isNotEmpty()) {
                Text(
                    text = thread.preview,
                    style = TextStyle(
                        fontFamily = Muller,
                        fontSize = 12.sp,
                        lineHeight = 17.sp,
                        color = NotePreviewColor,
                    ),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        // Дата прижата к низу карточки — как margin-top: auto в вебе
        Text(
            text = dateStr,
            style = TextStyle(fontFamily = Muller, fontSize = 11.sp, color = NoteDateColor),
            modifier = Modifier.align(Alignment.BottomStart),
        )
    }
}

// ─── Мелкие детали ──────────────────────────────────────────────────────────

/** Вкладка слайдера: активная — белая пилюля, текст Random Grotesque 14. */
@Composable
private fun TabPill(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .background(if (active) Color.White else Color.Transparent)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 16.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = TextStyle(
                fontFamily = RandomGrotesque,
                fontSize = 14.sp,
                color = if (active) TabActiveText else TabInactiveText,
            ),
        )
    }
}

/** Центрированное пустое состояние — Random Grotesque 15. */
@Composable
private fun EmptyState(text: String) {
    Text(
        text = text,
        style = TextStyle(
            fontFamily = RandomGrotesque,
            fontSize = 15.sp,
            color = EmptyStateColor,
            textAlign = TextAlign.Center,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 48.dp),
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

// ─── Нарисованные иконки (лупа, «+», «⋮», карандаш) ─────────────────────────

@Composable
private fun SearchIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = size.width * 0.09f, cap = StrokeCap.Round)
        drawCircle(
            color = color,
            radius = size.width * 0.28f,
            center = androidx.compose.ui.geometry.Offset(size.width * 0.42f, size.height * 0.42f),
            style = stroke,
        )
        drawPath(
            path = Path().apply {
                moveTo(size.width * 0.63f, size.height * 0.63f)
                lineTo(size.width * 0.85f, size.height * 0.85f)
            },
            color = color,
            style = stroke,
        )
    }
}

@Composable
private fun PlusIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = size.width * 0.08f, cap = StrokeCap.Round)
        drawPath(
            path = Path().apply {
                moveTo(size.width / 2f, size.height * 0.15f)
                lineTo(size.width / 2f, size.height * 0.85f)
                moveTo(size.width * 0.15f, size.height / 2f)
                lineTo(size.width * 0.85f, size.height / 2f)
            },
            color = color,
            style = stroke,
        )
    }
}

@Composable
private fun MoreVerticalIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val r = size.width * 0.09f
        listOf(0.22f, 0.5f, 0.78f).forEach { y ->
            drawCircle(
                color = color,
                radius = r,
                center = androidx.compose.ui.geometry.Offset(size.width / 2f, size.height * y),
            )
        }
    }
}

@Composable
private fun PencilIcon(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = size.width * 0.11f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        drawPath(
            path = Path().apply {
                // Корпус карандаша по диагонали
                moveTo(size.width * 0.72f, size.height * 0.12f)
                lineTo(size.width * 0.88f, size.height * 0.28f)
                lineTo(size.width * 0.30f, size.height * 0.86f)
                lineTo(size.width * 0.12f, size.height * 0.88f)
                lineTo(size.width * 0.14f, size.height * 0.70f)
                close()
            },
            color = color,
            style = stroke,
        )
    }
}

// ─── Шестерёнка (outline) — порт src/components/icons SettingsIcon ──────────

private val SettingsIconVector: ImageVector = ImageVector.Builder(
    name = "MindexSettingsThreads",
    defaultWidth = 24.dp,
    defaultHeight = 24.dp,
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

package ru.mindex.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import ru.mindex.app.ui.navigation.Routes
import ru.mindex.app.ui.theme.MindexColors

/**
 * Нижняя навигация — порт src/components/BottomNav.tsx.
 *
 * Пилюля с двумя вкладками (задачи / мысли) + доминантная тёмная FAB,
 * открывающая новый чат с Мыслью. Снизу — белый градиент-подложка,
 * чтобы список задач мягко уходил под навигацию.
 *
 * Размещается вызывающим экраном через Alignment.BottomCenter.
 */
@Composable
fun BottomNav(navController: NavHostController, current: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(160.dp)
            .background(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    0.5f to Color.White,
                    1f to Color.White,
                ),
            ),
    ) {
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(start = 16.dp, end = 16.dp, bottom = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // ─── Пилюля вкладок ──────────────────────────────
            Row(
                modifier = Modifier
                    .weight(1f)
                    .shadow(6.dp, CircleShape)
                    .clip(CircleShape)
                    .background(MindexColors.NavContainer)
                    .padding(5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                NavTab(
                    icon = CalendarIconVector,
                    active = current == Routes.DASH,
                    onClick = { navigateTab(navController, Routes.DASH, current) },
                )
                NavTab(
                    icon = ChatIconVector,
                    active = current == Routes.THREADS,
                    onClick = { navigateTab(navController, Routes.THREADS, current) },
                )
            }

            // ─── FAB — новый чат с Мыслью ────────────────────
            val fabInteraction = remember { MutableInteractionSource() }
            val fabPressed by fabInteraction.collectIsPressedAsState()
            val fabScale by animateFloatAsState(
                targetValue = if (fabPressed) 0.92f else 1f,
                animationSpec = spring(stiffness = Spring.StiffnessMedium),
                label = "fabScale",
            )
            Box(
                modifier = Modifier
                    .size(58.dp)
                    .graphicsLayer { scaleX = fabScale; scaleY = fabScale }
                    .shadow(8.dp, CircleShape)
                    .clip(CircleShape)
                    .background(MindexColors.FabDark)
                    .clickable(
                        interactionSource = fabInteraction,
                        indication = null,
                    ) { navController.navigate(Routes.chat("new")) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = ComposeIconVector,
                    contentDescription = "Новая мысль",
                    tint = Color.White,
                    modifier = Modifier.size(25.dp),
                )
            }
        }
    }
}

/** Переход по вкладке без роста backstack. */
private fun navigateTab(navController: NavHostController, route: String, current: String) {
    if (route == current) return
    navController.navigate(route) {
        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun RowScope.NavTab(icon: ImageVector, active: Boolean, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.9f else 1f,
        animationSpec = spring(stiffness = Spring.StiffnessMedium),
        label = "tabScale",
    )
    val background by animateColorAsState(
        targetValue = if (active) Color.White else Color.Transparent,
        label = "tabBg",
    )
    val tint by animateColorAsState(
        targetValue = if (active) MindexColors.FabDark else MindexColors.NavInactive,
        label = "tabTint",
    )
    Box(
        modifier = Modifier
            .weight(1f)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .then(if (active) Modifier.shadow(3.dp, CircleShape) else Modifier)
            .clip(CircleShape)
            .background(background)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(vertical = 15.dp, horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(26.dp),
        )
    }
}

// ─── Фирменные иконки (порт src/components/icons/index.tsx) ─────────────────

/** Календарь (filled) — вкладка задач. Источник: calendar.svg. */
private val CalendarIconVector: ImageVector = ImageVector.Builder(
    name = "MindexCalendar",
    defaultWidth = 26.dp,
    defaultHeight = 26.dp,
    viewportWidth = 90f,
    viewportHeight = 101f,
).addPath(
    pathData = addPathNodes(
        "M63 0C65.4852 3.37071e-08 67.4998 2.0149 67.5 4.5V11.6807C80.4236 14.899 90 26.5813 " +
            "90 40.501V71.1006C89.9998 87.5033 76.7025 100.801 60.2998 100.801H29.7002L28.9336 " +
            "100.791C12.8851 100.385 0.000208026 87.247 0 71.1006V40.501C0 26.9064 9.13394 " +
            "15.445 21.5996 11.9189V4.5C21.5998 2.01503 23.6146 0.00021124 26.0996 0C28.5848 " +
            "-9.19172e-08 30.5994 2.0149 30.5996 4.5V10.8008H58.5V4.5C58.5002 2.0149 60.5148 " +
            "9.19172e-08 63 0ZM9 71.1006C9.00021 82.5327 18.268 91.8008 29.7002 91.8008H60.2998C" +
            "71.732 91.8008 80.9998 82.5327 81 71.1006V41.4004H9V71.1006ZM29.7002 19.8008C" +
            "21.1425 19.8008 13.7982 24.9937 10.6455 32.4004H79.3545C76.2018 24.9937 68.8575 " +
            "19.8008 60.2998 19.8008H29.7002Z",
    ),
    fill = SolidColor(Color.Black),
).build()

/** Чат-пузырь (круглый, outline) — вкладка мыслей. Источник: note.svg. */
private val ChatIconVector: ImageVector = ImageVector.Builder(
    name = "MindexChat",
    defaultWidth = 26.dp,
    defaultHeight = 26.dp,
    viewportWidth = 90f,
    viewportHeight = 90f,
).addPath(
    pathData = addPathNodes(
        "M45 4.5C67.3675 4.5 85.5 22.6325 85.5 45C85.5 67.3675 67.3675 85.5 45 85.5H9.41016C" +
            "9.51901 85.3322 9.62935 85.1643 9.7373 84.9941C11.0655 82.9008 12.4451 80.4349 " +
            "13.2627 78.0557C13.6718 76.8652 14.0128 75.492 14.041 74.0752C14.0696 72.641 " +
            "13.7767 70.8716 12.5947 69.2979C7.51076 62.5294 4.5 54.1226 4.5 45C4.5 22.6325 " +
            "22.6325 4.5 45 4.5Z",
    ),
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 9f,
    strokeLineCap = StrokeCap.Butt,
).build()

/** Карандаш в скобке — FAB (новая мысль). Источник: new thread.svg. */
private val ComposeIconVector: ImageVector = ImageVector.Builder(
    name = "MindexCompose",
    defaultWidth = 25.dp,
    defaultHeight = 25.dp,
    viewportWidth = 95f,
    viewportHeight = 95f,
).addPath(
    pathData = addPathNodes(
        "M40.0004 64.5001H30.0004C30.0004 64.5001 29.5161 58.3751 30.0004 54.5001C31.0004 " +
            "46.5 40.0435 39.9565 50 30C59.9565 20.0435 79.0004 4.50334 80.0004 4.50005C" +
            "85.5233 4.48193 90.0004 8.97721 90.0004 14.5001C90.0004 15.5001 75.2397 34.5435 " +
            "65.2832 44.5C55.3268 54.4565 47.5 64.5001 40.0004 64.5001Z",
    ),
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 9f,
).addPath(
    pathData = addPathNodes(
        "M44.4453 11.6738C43.8563 12.2629 43.3008 12.873 42.7764 13.5H29.7002C18.2679 13.5 " +
            "9 22.7679 9 34.2002V64.7998C9 76.2321 18.2679 85.5 29.7002 85.5H60.2998C71.7321 " +
            "85.5 81 76.2321 81 64.7998V52.6494C81.8078 52.0059 82.5893 51.3121 83.3369 " +
            "50.5645L90 43.9004V64.7998C90 81.2027 76.7027 94.5 60.2998 94.5H29.7002L28.9336 " +
            "94.4902C12.8849 94.0837 0 80.9464 0 64.7998V34.2002C0 18.0536 12.8849 4.91627 " +
            "28.9336 4.50977L29.7002 4.5H51.6191L44.4453 11.6738Z",
    ),
    fill = SolidColor(Color.Black),
).build()

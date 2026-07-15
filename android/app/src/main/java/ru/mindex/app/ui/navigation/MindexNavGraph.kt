package ru.mindex.app.ui.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.SessionState
import ru.mindex.app.ui.screens.auth.AuthScreen
import ru.mindex.app.ui.screens.calendar.CalendarScreen
import ru.mindex.app.ui.screens.chat.ChatScreen
import ru.mindex.app.ui.screens.dashboard.DashboardScreen
import ru.mindex.app.ui.screens.notes.NoteScreen
import ru.mindex.app.ui.screens.onboarding.OnboardingScreen
import ru.mindex.app.ui.screens.settings.SettingsScreen
import ru.mindex.app.ui.screens.threads.ThreadsScreen
import ru.mindex.app.ui.screens.today.TodayScreen
import ru.mindex.app.ui.theme.MindexColors

/** Маршруты приложения — зеркало Screen-типа веб-клиента. */
object Routes {
    const val AUTH = "auth"
    const val ONBOARDING = "onboarding"
    const val DASH = "dash"
    const val TODAY = "today"
    const val THREADS = "threads"
    const val SETTINGS = "settings"
    const val CALENDAR = "calendar"
    const val CHAT = "chat/{threadId}"
    const val NOTE = "note/{noteId}"

    fun chat(threadId: String) = "chat/$threadId"
    fun note(noteId: String) = "note/$noteId"
}

@Composable
fun MindexNavGraph(navController: NavHostController, appViewModel: AppViewModel) {
    val session by appViewModel.session.collectAsState()

    when (val s = session) {
        SessionState.Loading -> {
            Box(
                modifier = Modifier.fillMaxSize().background(MindexColors.Bg),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = MindexColors.Accent)
            }
        }

        SessionState.LoggedOut -> AuthScreen(appViewModel = appViewModel)

        is SessionState.LoggedIn -> {
            if (s.needsOnboarding) {
                OnboardingScreen(appViewModel = appViewModel, user = s.user)
            } else {
                NavHost(navController = navController, startDestination = Routes.DASH) {
                    composable(Routes.DASH) {
                        DashboardScreen(appViewModel = appViewModel, navController = navController)
                    }
                    composable(Routes.TODAY) {
                        TodayScreen(appViewModel = appViewModel, navController = navController)
                    }
                    composable(Routes.THREADS) {
                        ThreadsScreen(appViewModel = appViewModel, navController = navController)
                    }
                    composable(Routes.SETTINGS) {
                        SettingsScreen(appViewModel = appViewModel, navController = navController)
                    }
                    composable(Routes.CALENDAR) {
                        CalendarScreen(appViewModel = appViewModel, navController = navController)
                    }
                    composable(Routes.CHAT) { backStackEntry ->
                        ChatScreen(
                            appViewModel = appViewModel,
                            navController = navController,
                            threadId = backStackEntry.arguments?.getString("threadId") ?: "new",
                        )
                    }
                    composable(Routes.NOTE) { backStackEntry ->
                        NoteScreen(
                            appViewModel = appViewModel,
                            navController = navController,
                            noteId = backStackEntry.arguments?.getString("noteId") ?: "",
                        )
                    }
                }
            }
        }
    }
}

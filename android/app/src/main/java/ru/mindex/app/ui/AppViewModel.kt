package ru.mindex.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import ru.mindex.app.data.model.LocalUser
import ru.mindex.app.data.model.UserSettings
import ru.mindex.app.di.AppContainer

/** Состояние сессии приложения. */
sealed interface SessionState {
    data object Loading : SessionState
    data object LoggedOut : SessionState
    data class LoggedIn(val user: LocalUser, val needsOnboarding: Boolean) : SessionState
}

/**
 * Корневая ViewModel: сессия + bootstrap данных.
 * Аналог логики входа в App.tsx веб-клиента.
 */
class AppViewModel(val container: AppContainer) : ViewModel() {

    private val _session = MutableStateFlow<SessionState>(SessionState.Loading)
    val session: StateFlow<SessionState> = _session.asStateFlow()

    val tasks = container.dataRepository.tasks
    val threads = container.dataRepository.threads
    val profile = container.dataRepository.profile
    val isSyncing = container.dataRepository.isSyncing

    init {
        viewModelScope.launch {
            val saved = container.authRepository.currentUser()
            if (saved == null) {
                _session.value = SessionState.LoggedOut
            } else {
                // Мгновенный вход по кэшу; валидация и данные — в фоне.
                container.dataRepository.bootstrap()
                val onboarding = container.dataRepository.profile.value?.onboardingComplete != true
                _session.value = SessionState.LoggedIn(saved, needsOnboarding = onboarding)
                container.authRepository.validateSession()
            }
        }
    }

    fun onLoggedIn(user: LocalUser) {
        viewModelScope.launch {
            container.dataRepository.bootstrap()
            val onboarding = container.dataRepository.profile.value?.onboardingComplete != true
            _session.value = SessionState.LoggedIn(user, needsOnboarding = onboarding)
        }
    }

    fun completeOnboarding(settings: UserSettings) {
        viewModelScope.launch {
            container.dataRepository.saveProfile(settings, onboardingComplete = true)
            val current = _session.value
            if (current is SessionState.LoggedIn) {
                _session.value = current.copy(needsOnboarding = false)
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            container.authRepository.logout()
            _session.value = SessionState.LoggedOut
        }
    }

    companion object {
        fun factory(container: AppContainer) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                AppViewModel(container) as T
        }
    }
}

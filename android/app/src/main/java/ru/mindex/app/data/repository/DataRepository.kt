package ru.mindex.app.data.repository

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import ru.mindex.app.data.local.CacheStore
import ru.mindex.app.data.local.SessionStore
import ru.mindex.app.data.model.LocalProfile
import ru.mindex.app.data.model.ProfileUpdateRequest
import ru.mindex.app.data.model.Task
import ru.mindex.app.data.model.TaskRequest
import ru.mindex.app.data.model.Thread
import ru.mindex.app.data.model.ThreadRequest
import ru.mindex.app.data.model.TimezoneRequest
import ru.mindex.app.data.model.UserSettings
import ru.mindex.app.data.network.MindexApi
import java.util.TimeZone

/**
 * Единый источник состояния задач/тредов/профиля.
 *
 * Стратегия синхронизации — как в веб-клиенте (src/lib/storage.ts):
 * оптимистичное обновление локально → отправка на сервер в фоне;
 * при bootstrap() сервер авторитетен.
 */
class DataRepository(
    private val api: MindexApi,
    private val session: SessionStore,
    private val cache: CacheStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _tasks = MutableStateFlow<List<Task>>(emptyList())
    val tasks: StateFlow<List<Task>> = _tasks.asStateFlow()

    private val _threads = MutableStateFlow<List<Thread>>(emptyList())
    val threads: StateFlow<List<Thread>> = _threads.asStateFlow()

    private val _profile = MutableStateFlow<LocalProfile?>(null)
    val profile: StateFlow<LocalProfile?> = _profile.asStateFlow()

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private suspend fun userId(): String? = session.currentUser()?.id

    /** Мгновенный старт из кэша, затем авторитетные данные с сервера. */
    suspend fun bootstrap() {
        val uid = userId() ?: return
        _tasks.value = cache.readTasks(uid)
        _threads.value = cache.readThreads(uid)
        _profile.value = cache.readProfile(uid)

        _isSyncing.value = true
        runCatching {
            val remote = api.bootstrap()
            _tasks.value = remote.tasks
            _threads.value = remote.threads.sortedByDescending { it.updatedAt ?: it.createdAt }
            remote.profile?.let { _profile.value = it }
            cache.writeTasks(uid, remote.tasks)
            cache.writeThreads(uid, remote.threads)
            remote.profile?.let { cache.writeProfile(uid, it) }
            api.saveTimezone(TimezoneRequest(TimeZone.getDefault().id))
        }
        _isSyncing.value = false
    }

    // ─── Tasks ───────────────────────────────────────────────

    suspend fun upsertTask(task: Task) {
        val uid = userId() ?: return
        _tasks.value = _tasks.value.filterNot { it.id == task.id } + task
        cache.writeTasks(uid, _tasks.value)
        scope.launch { runCatching { api.saveTask(TaskRequest(task)) } }
    }

    suspend fun deleteTask(id: String) {
        val uid = userId() ?: return
        _tasks.value = _tasks.value.filterNot { it.id == id }
        cache.writeTasks(uid, _tasks.value)
        scope.launch { runCatching { api.deleteTask(id) } }
    }

    suspend fun toggleTask(id: String) {
        _tasks.value.firstOrNull { it.id == id }?.let { upsertTask(it.copy(done = !it.done)) }
    }

    // ─── Threads ─────────────────────────────────────────────

    suspend fun upsertThread(thread: Thread) {
        val uid = userId() ?: return
        _threads.value = (_threads.value.filterNot { it.id == thread.id } + thread)
            .sortedByDescending { it.updatedAt ?: it.createdAt }
        cache.writeThreads(uid, _threads.value)
        scope.launch { runCatching { api.saveThread(ThreadRequest(thread)) } }
    }

    suspend fun deleteThread(id: String) {
        val uid = userId() ?: return
        _threads.value = _threads.value.filterNot { it.id == id }
        cache.writeThreads(uid, _threads.value)
        scope.launch { runCatching { api.deleteThread(id) } }
    }

    // ─── Profile ─────────────────────────────────────────────

    suspend fun saveProfile(settings: UserSettings, onboardingComplete: Boolean) {
        val uid = userId() ?: return
        val profile = LocalProfile(settings, onboardingComplete)
        _profile.value = profile
        cache.writeProfile(uid, profile)
        scope.launch {
            runCatching { api.saveProfile(ProfileUpdateRequest(settings, onboardingComplete)) }
        }
    }

    fun clearMemory() {
        _tasks.value = emptyList()
        _threads.value = emptyList()
        scope.launch { userId()?.let { cache.clear(it) } }
    }
}

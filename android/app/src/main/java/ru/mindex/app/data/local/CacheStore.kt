package ru.mindex.app.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import ru.mindex.app.data.model.LocalProfile
import ru.mindex.app.data.model.Task
import ru.mindex.app.data.model.Thread

private val Context.cacheDataStore: DataStore<Preferences> by preferencesDataStore(name = "mx_cache")

/**
 * Офлайн-копия задач/тредов/профиля — аналог localStorage-ключей
 * mx_tasks_{userId} / mx_threads_{userId} / mx_profile_{userId}.
 * Сервер авторитетен; кэш нужен для мгновенного старта и офлайна.
 */
class CacheStore(private val context: Context, private val json: Json) {

    private fun tasksKey(userId: String) = stringPreferencesKey("mx_tasks_$userId")
    private fun threadsKey(userId: String) = stringPreferencesKey("mx_threads_$userId")
    private fun profileKey(userId: String) = stringPreferencesKey("mx_profile_$userId")

    suspend fun readTasks(userId: String): List<Task> =
        context.cacheDataStore.data.first()[tasksKey(userId)]?.let { raw ->
            runCatching {
                json.decodeFromString(ListSerializer(Task.serializer()), raw)
            }.getOrDefault(emptyList())
        } ?: emptyList()

    suspend fun writeTasks(userId: String, tasks: List<Task>) {
        context.cacheDataStore.edit { prefs ->
            prefs[tasksKey(userId)] =
                json.encodeToString(ListSerializer(Task.serializer()), tasks)
        }
    }

    suspend fun readThreads(userId: String): List<Thread> =
        context.cacheDataStore.data.first()[threadsKey(userId)]?.let { raw ->
            runCatching {
                json.decodeFromString(ListSerializer(Thread.serializer()), raw)
            }.getOrDefault(emptyList())
        } ?: emptyList()

    suspend fun writeThreads(userId: String, threads: List<Thread>) {
        context.cacheDataStore.edit { prefs ->
            prefs[threadsKey(userId)] =
                json.encodeToString(ListSerializer(Thread.serializer()), threads)
        }
    }

    suspend fun readProfile(userId: String): LocalProfile? =
        context.cacheDataStore.data.first()[profileKey(userId)]?.let { raw ->
            runCatching { json.decodeFromString<LocalProfile>(raw) }.getOrNull()
        }

    suspend fun writeProfile(userId: String, profile: LocalProfile) {
        context.cacheDataStore.edit { prefs ->
            prefs[profileKey(userId)] = json.encodeToString(LocalProfile.serializer(), profile)
        }
    }

    suspend fun clear(userId: String) {
        context.cacheDataStore.edit { prefs ->
            prefs.remove(tasksKey(userId))
            prefs.remove(threadsKey(userId))
            prefs.remove(profileKey(userId))
        }
    }
}

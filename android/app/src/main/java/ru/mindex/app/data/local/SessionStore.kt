package ru.mindex.app.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import ru.mindex.app.data.model.LocalUser

private val Context.sessionDataStore: DataStore<Preferences> by preferencesDataStore(name = "mx_session")

/**
 * Сессия пользователя — аналог localStorage-ключей
 * mx_session_token / mx_current_user веб-клиента.
 */
class SessionStore(private val context: Context, private val json: Json) {

    private object Keys {
        val TOKEN = stringPreferencesKey("mx_session_token")
        val USER = stringPreferencesKey("mx_current_user")
    }

    /** Кэш токена в памяти — интерцептору нужен синхронный доступ. */
    @Volatile
    var cachedToken: String? = null
        private set

    init {
        // Однократное чтение при создании (запуск приложения).
        cachedToken = runBlocking {
            context.sessionDataStore.data.first()[Keys.TOKEN]
        }
    }

    val user: Flow<LocalUser?> = context.sessionDataStore.data.map { prefs ->
        prefs[Keys.USER]?.let { raw ->
            runCatching { json.decodeFromString<LocalUser>(raw) }.getOrNull()
        }
    }

    suspend fun currentUser(): LocalUser? = user.first()

    suspend fun save(user: LocalUser, token: String?) {
        context.sessionDataStore.edit { prefs ->
            prefs[Keys.USER] = json.encodeToString(LocalUser.serializer(), user)
            if (!token.isNullOrBlank()) prefs[Keys.TOKEN] = token
        }
        if (!token.isNullOrBlank()) cachedToken = token
    }

    suspend fun clear() {
        context.sessionDataStore.edit { it.clear() }
        cachedToken = null
    }
}

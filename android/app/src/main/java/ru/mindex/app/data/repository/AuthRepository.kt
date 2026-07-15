package ru.mindex.app.data.repository

import ru.mindex.app.data.local.CacheStore
import ru.mindex.app.data.local.SessionStore
import ru.mindex.app.data.model.LocalUser
import ru.mindex.app.data.model.YandexAuthRequest
import ru.mindex.app.data.network.MindexApi

/**
 * Авторизация через Яндекс OAuth (код обменивается на сервере,
 * как в src/lib/yandex-auth.ts) + восстановление сессии.
 */
class AuthRepository(
    private val api: MindexApi,
    private val session: SessionStore,
    private val cache: CacheStore,
) {
    val userFlow = session.user

    suspend fun currentUser(): LocalUser? = session.currentUser()

    /** URL страницы авторизации Яндекса; clientId приходит с /api/config. */
    suspend fun yandexAuthorizeUrl(state: String): String? {
        val clientId = runCatching { api.config().yandexClientId }.getOrNull() ?: return null
        return "https://oauth.yandex.ru/authorize" +
            "?response_type=code" +
            "&client_id=$clientId" +
            "&state=$state"
    }

    /** Обмен authorization code → сессия. */
    suspend fun loginWithYandexCode(code: String, redirectUri: String?): LocalUser {
        val response = api.authYandex(YandexAuthRequest(code = code, redirectUri = redirectUri))
        session.save(response.user, response.token)
        return response.user
    }

    /** Проверка живости токена при старте. */
    suspend fun validateSession(): LocalUser? = runCatching {
        api.me().user.also { session.save(it, null) }
    }.getOrNull()

    suspend fun logout() {
        currentUser()?.let { cache.clear(it.id) }
        session.clear()
    }
}

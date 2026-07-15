package ru.mindex.app.data.network

import okhttp3.Interceptor
import okhttp3.Response

/**
 * Подставляет Bearer-токен сессии во все запросы к бэкенду —
 * так же, как apiFetch() в src/lib/auth.ts веб-клиента.
 */
class AuthInterceptor(private val tokenProvider: () -> String?) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenProvider()
        val request = if (token.isNullOrBlank()) {
            chain.request()
        } else {
            chain.request().newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        }
        return chain.proceed(request)
    }
}

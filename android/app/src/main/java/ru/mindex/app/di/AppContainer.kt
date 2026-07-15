package ru.mindex.app.di

import android.content.Context
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import ru.mindex.app.BuildConfig
import ru.mindex.app.data.local.CacheStore
import ru.mindex.app.data.local.SessionStore
import ru.mindex.app.data.network.AuthInterceptor
import ru.mindex.app.data.network.MindexApi
import ru.mindex.app.data.repository.AuthRepository
import ru.mindex.app.data.repository.ChatRepository
import ru.mindex.app.data.repository.DataRepository
import java.util.concurrent.TimeUnit

/**
 * Ручной DI-контейнер. Hilt намеренно не используется:
 * граф зависимостей маленький, а лишний кодоген — лишний вес
 * и точка отказа (см. правило «не добавляй зависимости без обоснования»).
 */
class AppContainer(context: Context) {

    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
        coerceInputValues = true
    }

    val sessionStore = SessionStore(context, json)
    private val cacheStore = CacheStore(context, json)

    private val okHttp: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(AuthInterceptor { sessionStore.cachedToken })
        .apply {
            if (BuildConfig.DEBUG) {
                addInterceptor(HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                })
            }
        }
        .connectTimeout(20, TimeUnit.SECONDS)
        // ИИ может думать долго — как 90-секундный таймаут в groq.ts.
        .readTimeout(90, TimeUnit.SECONDS)
        .build()

    private val api: MindexApi = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(okHttp)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(MindexApi::class.java)

    val authRepository = AuthRepository(api, sessionStore, cacheStore)
    val dataRepository = DataRepository(api, sessionStore, cacheStore)
    val chatRepository = ChatRepository(api, dataRepository, json)
}

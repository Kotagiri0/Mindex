package ru.mindex.app.data.network

import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import ru.mindex.app.data.model.AppConfig
import ru.mindex.app.data.model.AuthResponse
import ru.mindex.app.data.model.BootstrapResponse
import ru.mindex.app.data.model.ChatRequest
import ru.mindex.app.data.model.ChatResponse
import ru.mindex.app.data.model.ProfileUpdateRequest
import ru.mindex.app.data.model.SuccessResponse
import ru.mindex.app.data.model.SummarizeRequest
import ru.mindex.app.data.model.SummarizeResponse
import ru.mindex.app.data.model.TaskRequest
import ru.mindex.app.data.model.ThreadRequest
import ru.mindex.app.data.model.TimezoneRequest
import ru.mindex.app.data.model.TranscribeResponse
import ru.mindex.app.data.model.UserResponse
import ru.mindex.app.data.model.YandexAuthRequest

/**
 * HTTP-контракт с бэкендом Mindex — те же маршруты /api/...,
 * которые использует веб-клиент. Авторизация — Bearer-токен
 * (подставляется AuthInterceptor).
 */
interface MindexApi {

    // ─── Config ──────────────────────────────────────────────
    @GET("/api/config")
    suspend fun config(): AppConfig

    // ─── Auth ────────────────────────────────────────────────
    @POST("/api/auth/yandex")
    suspend fun authYandex(@Body body: YandexAuthRequest): AuthResponse

    @GET("/api/auth/me")
    suspend fun me(): UserResponse

    // ─── Data ────────────────────────────────────────────────
    @GET("/api/data/bootstrap")
    suspend fun bootstrap(): BootstrapResponse

    @POST("/api/data/profile")
    suspend fun saveProfile(@Body body: ProfileUpdateRequest): SuccessResponse

    @POST("/api/data/timezone")
    suspend fun saveTimezone(@Body body: TimezoneRequest): SuccessResponse

    @POST("/api/data/task")
    suspend fun saveTask(@Body body: TaskRequest): SuccessResponse

    @DELETE("/api/data/task/{id}")
    suspend fun deleteTask(@Path("id") id: String): SuccessResponse

    @POST("/api/data/thread")
    suspend fun saveThread(@Body body: ThreadRequest): SuccessResponse

    @PATCH("/api/data/thread/{id}/archive")
    suspend fun archiveThread(@Path("id") id: String): SuccessResponse

    @DELETE("/api/data/thread/{id}")
    suspend fun deleteThread(@Path("id") id: String): SuccessResponse

    // ─── AI ──────────────────────────────────────────────────
    @POST("/api/chat")
    suspend fun chat(@Body body: ChatRequest): ChatResponse

    @POST("/api/summarize")
    suspend fun summarize(@Body body: SummarizeRequest): SummarizeResponse

    @Multipart
    @POST("/api/voice/transcribe")
    suspend fun transcribe(@Part audio: MultipartBody.Part): TranscribeResponse
}
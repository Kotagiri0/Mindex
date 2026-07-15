package ru.mindex.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Модели данных — зеркало src/types.ts веб-клиента.
 * Формат сериализации 1:1 с тем, что ожидает бэкенд.
 */

@Serializable
data class SubTask(
    val id: String,
    val name: String,
    val done: Boolean = false,
)

/** Сфера задачи. Управляет цветом блока в календаре. 'none' — серый. */
enum class TaskCategory(val wire: String) {
    WORK("work"), PERSONAL("personal"), EVENT("event"), STUDY("study"), NONE("none");

    companion object {
        fun from(value: String?): TaskCategory =
            entries.firstOrNull { it.wire == value } ?: NONE
    }
}

@Serializable
data class Task(
    val id: String,
    val name: String,
    /** Время начала "HH:MM". Пусто — задача без времени. */
    val time: String = "",
    val date: String,
    val done: Boolean = false,
    val threadId: String? = null,
    val type: String? = "regular", // regular | thought
    val subtasks: List<SubTask>? = null,
    val calendarEventId: String? = null,
    val description: String? = null,
    val location: String? = null,
    /** Время конца "HH:MM". Есть и time, и endTime — диапазон. */
    val endTime: String? = null,
    val category: String? = "none",
    /** 'user' — поставил человек (свято), 'agent' — предложил агент. */
    val timeSource: String? = "user",
    val suggestedTime: String? = null,
    val suggestedEndTime: String? = null,
) {
    val categoryEnum: TaskCategory get() = TaskCategory.from(category)
}

@Serializable
data class PlanningQuestion(
    val id: String,
    val question: String,
    val options: List<String> = emptyList(),
)

@Serializable
data class Plan(
    val title: String,
    val steps: List<String> = emptyList(),
)

@Serializable
data class PlanningData(
    val questions: List<PlanningQuestion> = emptyList(),
    val answers: Map<String, String>? = null,
    val plan: Plan? = null,
    /** questionnaire | plan_generated | accepted | rejected */
    val status: String = "questionnaire",
)

@Serializable
data class MessageSource(
    val title: String,
    val snippet: String? = null,
)

@Serializable
data class ToolCallFunction(
    val name: String,
    val arguments: String = "{}",
)

@Serializable
data class ToolCall(
    val id: String,
    val type: String = "function",
    val function: ToolCallFunction,
)

@Serializable
data class Message(
    val role: String, // user | assistant | tool
    val content: String = "",
    val time: String = "",
    @SerialName("tool_calls") val toolCalls: List<ToolCall>? = null,
    @SerialName("tool_call_id") val toolCallId: String? = null,
    @SerialName("reasoning_content") val reasoningContent: String? = null,
    val sources: List<MessageSource>? = null,
    @SerialName("planning_data") val planningData: PlanningData? = null,
)

@Serializable
data class Thread(
    val id: String,
    val title: String,
    val preview: String = "",
    val messages: List<Message> = emptyList(),
    val createdAt: Long,
    val updatedAt: Long? = null,
    /** thread | text | мысль | заметка | skill */
    val source: String? = "thread",
    val label: String? = null,
    val summary: String? = null,
    @SerialName("is_meaningful") val isMeaningful: Boolean? = null,
)

@Serializable
data class UserSettings(
    val agent: Boolean = true,
    val confirm: Boolean = false,
    val notifs: Boolean = true,
    val name: String? = null,
    val avatar: String? = null,
    val email: String? = null,
    val instructions: String? = null,
)

@Serializable
data class LocalProfile(
    val settings: UserSettings = UserSettings(),
    @SerialName("onboarding_complete") val onboardingComplete: Boolean = false,
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
data class LocalUser(
    val id: String,
    val username: String,
    val displayName: String,
    val createdAt: Long = 0,
    val provider: String? = null, // local | google | email | yandex
    val email: String? = null,
    val avatarUrl: String? = null,
)

// ─── Сетевые обёртки ────────────────────────────────────────────────────────

@Serializable
data class AuthResponse(
    val user: LocalUser,
    val token: String? = null,
)

@Serializable
data class YandexAuthRequest(
    val code: String,
    val redirectUri: String? = null,
    val consent: Boolean? = null,
)

@Serializable
data class BootstrapResponse(
    val profile: LocalProfile? = null,
    val tasks: List<Task> = emptyList(),
    val threads: List<Thread> = emptyList(),
)

@Serializable
data class ProfileUpdateRequest(
    val settings: UserSettings,
    @SerialName("onboarding_complete") val onboardingComplete: Boolean,
)

@Serializable
data class TimezoneRequest(val timezone: String)

@Serializable
data class TaskRequest(val task: Task)

@Serializable
data class ThreadRequest(val thread: Thread)

@Serializable
data class SuccessResponse(val success: Boolean = true)

@Serializable
data class AppConfig(
    val supabaseUrl: String? = null,
    val supabaseAnonKey: String? = null,
    val googleClientId: String? = null,
    val yandexClientId: String? = null,
)

@Serializable
data class ChatRequestMessage(
    val role: String,
    val content: String,
    @SerialName("tool_calls") val toolCalls: List<ToolCall>? = null,
    @SerialName("tool_call_id") val toolCallId: String? = null,
)

@Serializable
data class ChatRequest(
    val messages: List<ChatRequestMessage>,
    val systemInstruction: String? = null,
    val tools: List<JsonObject>? = null,
    @SerialName("tool_choice") val toolChoice: String? = null,
    @SerialName("no_tools") val noTools: Boolean? = null,
)

@Serializable
data class ChatResponse(
    val role: String = "assistant",
    val content: String? = null,
    @SerialName("tool_calls") val toolCalls: List<ToolCall>? = null,
    @SerialName("reasoning_content") val reasoningContent: String? = null,
)

@Serializable
data class SummarizeRequest(val messages: List<ChatRequestMessage>)

@Serializable
data class SummarizeResponse(val summary: String? = null)

@Serializable
data class TranscribeResponse(val text: String? = null)

@Serializable
data class UserResponse(val user: LocalUser)

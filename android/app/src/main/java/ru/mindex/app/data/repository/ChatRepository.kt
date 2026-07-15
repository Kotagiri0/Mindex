package ru.mindex.app.data.repository

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import ru.mindex.app.data.model.ChatRequest
import ru.mindex.app.data.model.ChatRequestMessage
import ru.mindex.app.data.model.ChatResponse
import ru.mindex.app.data.model.Message
import ru.mindex.app.data.model.Plan
import ru.mindex.app.data.model.PlanningData
import ru.mindex.app.data.model.PlanningQuestion
import ru.mindex.app.data.model.SubTask
import ru.mindex.app.data.model.SummarizeRequest
import ru.mindex.app.data.model.Task
import ru.mindex.app.data.model.Thread
import ru.mindex.app.data.network.MindexApi
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/** Результат одного хода диалога с Мыслью. */
sealed interface ChatTurn {
    /** Обычный финальный ответ ассистента (+ промежуточные tool-сообщения). */
    data class Answer(val turnMessages: List<Message>, val finalMessage: Message) : ChatTurn

    /** Модель запустила планирование — показываем вопросник, ход завершён. */
    data class Planning(val message: Message) : ChatTurn
}

/**
 * Диалоговый конвейер Мысли — порт логики send() из AIChat.tsx:
 * история → /api/chat → цикл tool_calls (инструменты исполняются
 * на клиенте) → финальный ответ. Системный промпт и определения
 * инструментов живут на сервере.
 */
class ChatRepository(
    private val api: MindexApi,
    private val data: DataRepository,
    private val json: Json,
) {

    private fun ft(): String =
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())

    private fun today(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

    suspend fun sendMessage(history: List<Message>, threadId: String?): ChatTurn {
        var conversation = history.toMutableList()
        val turnMessages = mutableListOf<Message>()

        var response = requestChat(conversation)

        while (!response.toolCalls.isNullOrEmpty()) {
            val assistantToolMsg = Message(
                role = "assistant",
                content = response.content ?: "",
                toolCalls = response.toolCalls,
                time = ft(),
            )
            turnMessages += assistantToolMsg
            conversation += assistantToolMsg

            val toolResults = mutableListOf<Message>()
            for (call in response.toolCalls!!) {
                val args = runCatching {
                    json.parseToJsonElement(call.function.arguments).jsonObject
                }.getOrDefault(JsonObject(emptyMap()))

                when (call.function.name) {
                    "start_planning" -> {
                        val questions = args["questions"]?.jsonArray?.mapNotNull { q ->
                            runCatching {
                                json.decodeFromJsonElement(PlanningQuestion.serializer(), q)
                            }.getOrNull()
                        } ?: emptyList()
                        return ChatTurn.Planning(
                            Message(
                                role = "assistant",
                                content = "Чтобы составить лучший план, мне нужно уточнить пару деталей:",
                                time = ft(),
                                planningData = PlanningData(questions = questions, status = "questionnaire"),
                            )
                        )
                    }
                    else -> {
                        val result = executeTool(call.function.name, args, threadId)
                        toolResults += Message(
                            role = "tool",
                            toolCallId = call.id,
                            content = result,
                            time = ft(),
                        )
                    }
                }
            }

            turnMessages += toolResults
            conversation += toolResults
            response = requestChat(conversation)
        }

        val finalMessage = Message(
            role = "assistant",
            content = response.content ?: "Готово!",
            time = ft(),
        )
        return ChatTurn.Answer(turnMessages, finalMessage)
    }

    private suspend fun requestChat(messages: List<Message>, noTools: Boolean = false): ChatResponse =
        api.chat(
            ChatRequest(
                messages = messages.map {
                    ChatRequestMessage(
                        role = it.role,
                        content = it.content,
                        toolCalls = it.toolCalls,
                        toolCallId = it.toolCallId,
                    )
                },
                noTools = if (noTools) true else null,
            )
        )

    /** Исполнение инструмента на клиенте — зеркало switch-блока AIChat.tsx. */
    private suspend fun executeTool(name: String, args: JsonObject, threadId: String?): String {
        fun str(key: String): String? = (args[key] as? JsonPrimitive)?.contentOrNullSafe()

        return when (name) {
            "get_tasks" -> {
                val date = str("date")
                val filtered = data.tasks.value.let { all ->
                    if (date != null) all.filter { it.date == date } else all
                }
                if (filtered.isEmpty()) jsonString("Задач не найдено.")
                else json.encodeToString(
                    kotlinx.serialization.builtins.ListSerializer(Task.serializer()), filtered
                )
            }

            "get_notes" -> {
                val notes = data.threads.value.filter { it.source == "заметка" }
                if (notes.isEmpty()) jsonString("Заметок нет.")
                else buildJsonArray {
                    notes.forEach { n ->
                        add(buildJsonObject {
                            put("id", n.id); put("title", n.title); put("preview", n.preview)
                        })
                    }
                }.toString()
            }

            "add_task" -> {
                val time = str("time") ?: ""
                val task = Task(
                    id = UUID.randomUUID().toString(),
                    name = str("name") ?: "Задача",
                    time = time,
                    endTime = str("endTime"),
                    date = str("date") ?: today(),
                    done = false,
                    threadId = threadId,
                    category = str("category") ?: "none",
                    timeSource = if (time.isNotBlank()) "agent" else null,
                    suggestedTime = str("suggestedTime"),
                    suggestedEndTime = str("suggestedEndTime"),
                    description = str("description"),
                    location = str("location"),
                )
                data.upsertTask(task)
                val warnings = checkTaskConflicts(data.tasks.value, task)
                buildJsonObject {
                    put("status", "success")
                    put("task", json.encodeToJsonElement(Task.serializer(), task))
                    if (warnings.isNotEmpty()) {
                        put("warnings", buildJsonArray { warnings.forEach { add(JsonPrimitive(it)) } })
                    }
                }.toString()
            }

            "update_task" -> {
                val id = str("id")
                val existing = data.tasks.value.firstOrNull { it.id == id }
                if (existing == null) {
                    buildJsonObject { put("status", "error"); put("message", "Задача не найдена") }.toString()
                } else {
                    val newTime = str("time")
                    val timeChanged = newTime != null && newTime != existing.time
                    val updated = existing.copy(
                        done = (args["done"] as? JsonPrimitive)?.booleanOrNullSafe() ?: existing.done,
                        name = str("name") ?: existing.name,
                        time = newTime ?: existing.time,
                        endTime = str("endTime") ?: existing.endTime,
                        date = str("date") ?: existing.date,
                        category = str("category") ?: existing.category,
                        timeSource = if (timeChanged) "agent" else existing.timeSource,
                        description = str("description") ?: existing.description,
                        location = str("location") ?: existing.location,
                    )
                    data.upsertTask(updated)
                    val warnings = if (newTime != null || str("date") != null)
                        checkTaskConflicts(data.tasks.value, updated) else emptyList()
                    buildJsonObject {
                        put("status", "success")
                        if (warnings.isNotEmpty()) {
                            put("warnings", buildJsonArray { warnings.forEach { add(JsonPrimitive(it)) } })
                        }
                    }.toString()
                }
            }

            "delete_task" -> {
                str("id")?.let { data.deleteTask(it) }
                """{"status":"success"}"""
            }

            "delete_note" -> {
                str("id")?.let { data.deleteThread(it) }
                """{"status":"success"}"""
            }

            "save_as_note" -> {
                val content = (str("content") ?: "").trim()
                val noteId = UUID.randomUUID().toString()
                val note = Thread(
                    id = noteId,
                    title = (str("title") ?: content.take(40)).ifBlank { "Заметка" },
                    preview = content.take(100),
                    messages = emptyList(),
                    createdAt = System.currentTimeMillis(),
                    source = "заметка",
                    isMeaningful = true,
                    summary = content,
                )
                data.upsertThread(note)
                buildJsonObject { put("status", "success"); put("noteId", noteId) }.toString()
            }

            else -> """{"status":"error","message":"unknown tool"}"""
        }
    }

    /** Порт checkTaskConflicts(): пересечение ±30 минут и дубли имён за день. */
    private fun checkTaskConflicts(allTasks: List<Task>, task: Task): List<String> {
        val warnings = mutableListOf<String>()
        if (task.time.isNotBlank() && task.date.isNotBlank()) {
            val parts = task.time.split(":").mapNotNull { it.toIntOrNull() }
            if (parts.size == 2) {
                val taskMinutes = parts[0] * 60 + parts[1]
                for (t in allTasks) {
                    if (t.id == task.id || t.done || t.date != task.date || t.time.isBlank()) continue
                    val tp = t.time.split(":").mapNotNull { it.toIntOrNull() }
                    if (tp.size != 2) continue
                    if (kotlin.math.abs(taskMinutes - (tp[0] * 60 + tp[1])) <= 30) {
                        warnings += "конфликт по времени: \"${t.name}\" в ${t.time} — пересечение ±30 минут"
                    }
                }
            }
        }
        return warnings
    }

    /** Заголовок треда по первому обмену (no_tools-запрос, как generateTitle()). */
    suspend fun generateTitle(userText: String, assistantText: String): String? = runCatching {
        val prompt = "Придумай короткий заголовок (3–5 слов, без кавычек) для диалога:\n" +
            "Пользователь: ${userText.take(300)}\nОтвет: ${assistantText.take(300)}"
        requestChat(
            listOf(Message(role = "user", content = prompt, time = ft())),
            noTools = true,
        ).content?.trim()?.trim('"')?.takeIf { it.isNotBlank() }
    }.getOrNull()

    suspend fun summarize(messages: List<Message>): String? = runCatching {
        api.summarize(
            SummarizeRequest(messages.map { ChatRequestMessage(it.role, it.content) })
        ).summary
    }.getOrNull()

    /** Голос → текст через /api/voice/transcribe (audio/mp4 с MediaRecorder). */
    suspend fun transcribe(file: File): String? = runCatching {
        val part = MultipartBody.Part.createFormData(
            "audio", "voice.m4a", file.asRequestBody("audio/mp4".toMediaType())
        )
        api.transcribe(part).text?.takeIf { it.isNotBlank() }
    }.getOrNull()

    /** Создание задач из принятого плана (accepted). */
    suspend fun acceptPlan(plan: Plan, threadId: String?) {
        val date = today()
        val parent = Task(
            id = UUID.randomUUID().toString(),
            name = plan.title,
            time = "",
            date = date,
            done = false,
            threadId = threadId,
            subtasks = plan.steps.map { SubTask(UUID.randomUUID().toString(), it, false) },
        )
        data.upsertTask(parent)
    }
}

private fun JsonPrimitive.contentOrNullSafe(): String? =
    if (this is kotlinx.serialization.json.JsonNull) null else content

private fun JsonPrimitive.booleanOrNullSafe(): Boolean? =
    runCatching { boolean }.getOrNull()

private fun jsonString(s: String): String = JsonPrimitive(s).toString()

package ru.mindex.app.ui.screens.auth

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.launch
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.RandomGrotesque
import java.util.UUID

/**
 * Вход через Яндекс OAuth (code-flow):
 * WebView открывает oauth.yandex.ru, перехватываем redirect с ?code=,
 * бэкенд меняет код на сессию (POST /api/auth/yandex).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun AuthScreen(appViewModel: AppViewModel) {
    val scope = rememberCoroutineScope()
    val authRepo = appViewModel.container.authRepository

    var authUrl by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val state = remember { UUID.randomUUID().toString() }

    fun handleCode(code: String) {
        authUrl = null
        loading = true
        scope.launch {
            runCatching { authRepo.loginWithYandexCode(code, redirectUri = null) }
                .onSuccess { appViewModel.onLoggedIn(it) }
                .onFailure {
                    loading = false
                    error = "Не получилось войти. Попробуй ещё раз."
                }
        }
    }

    when {
        // ─── Экран OAuth-диалога Яндекса ─────────────────────
        authUrl != null -> {
            Box(Modifier.fillMaxSize().background(MindexColors.Bg).statusBarsPadding()) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            webViewClient = object : WebViewClient() {
                                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                    val uri = url?.let(Uri::parse) ?: return
                                    val code = uri.getQueryParameter("code")
                                    val returnedState = uri.getQueryParameter("state")
                                    if (code != null && (returnedState == null || returnedState == state)) {
                                        view?.stopLoading()
                                        handleCode(code)
                                    }
                                }
                            }
                            loadUrl(authUrl!!)
                        }
                    },
                )
            }
        }

        // ─── Стартовый экран входа ───────────────────────────
        else -> {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MindexColors.Bg)
                    .padding(horizontal = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(MindexColors.Accent),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "м",
                        fontFamily = RandomGrotesque,
                        fontSize = 40.sp,
                        color = MindexColors.AccentText,
                    )
                }
                Box(Modifier.height(28.dp))
                Text(
                    "есть мысли?",
                    style = MaterialTheme.typography.displaySmall,
                    textAlign = TextAlign.Center,
                )
                Box(Modifier.height(8.dp))
                Text(
                    "Мысль превратит их в план",
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
                Box(Modifier.height(40.dp))

                if (loading) {
                    CircularProgressIndicator(color = MindexColors.Accent)
                } else {
                    Button(
                        onClick = {
                            error = null
                            loading = true
                            scope.launch {
                                val url = authRepo.yandexAuthorizeUrl(state)
                                loading = false
                                if (url == null) {
                                    error = "Сервер недоступен. Проверь интернет и попробуй снова."
                                } else {
                                    authUrl = url
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MindexColors.Accent,
                            contentColor = MindexColors.AccentText,
                        ),
                    ) {
                        Text("Войти через Яндекс", style = MaterialTheme.typography.labelLarge.copy(color = MindexColors.AccentText))
                    }
                }

                error?.let {
                    Box(Modifier.height(16.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall.copy(color = MindexColors.Danger))
                    TextButton(onClick = { error = null }) {
                        Text("Повторить", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

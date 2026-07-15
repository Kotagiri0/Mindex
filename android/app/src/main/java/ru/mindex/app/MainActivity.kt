package ru.mindex.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.rememberNavController
import ru.mindex.app.ui.AppViewModel
import ru.mindex.app.ui.navigation.MindexNavGraph
import ru.mindex.app.ui.theme.MindexColors
import ru.mindex.app.ui.theme.MindexTheme
import androidx.compose.foundation.layout.Box

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as MindexApp).container
        setContent {
            MindexTheme {
                val navController = rememberNavController()
                val appViewModel: AppViewModel =
                    viewModel(factory = AppViewModel.factory(container))
                Box(Modifier.fillMaxSize().background(MindexColors.Bg)) {
                    MindexNavGraph(navController = navController, appViewModel = appViewModel)
                }
            }
        }
    }
}

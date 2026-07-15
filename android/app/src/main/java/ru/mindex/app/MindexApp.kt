package ru.mindex.app

import android.app.Application
import ru.mindex.app.di.AppContainer

class MindexApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

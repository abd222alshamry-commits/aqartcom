package com.aqartkom.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import com.aqartkom.nativeapp.ui.AqartkomApp
import com.aqartkom.nativeapp.ui.AqartkomTheme

class MainActivity : ComponentActivity() {
    private val viewModel by viewModels<AppViewModel>()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val systemDark = isSystemInDarkTheme()
            val preferences = remember { getSharedPreferences("aqartkom_preferences", MODE_PRIVATE) }
            var dark by rememberSaveable {
                mutableStateOf(if (preferences.contains("dark_mode")) preferences.getBoolean("dark_mode", systemDark) else systemDark)
            }
            LaunchedEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                    else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
            }
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                AqartkomTheme(dark) {
                    AqartkomApp(viewModel, dark) {
                        dark = !dark
                        preferences.edit().putBoolean("dark_mode", dark).apply()
                    }
                }
            }
        }
    }
}

package com.aqartkom.nativeapp.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.Typography
import androidx.compose.material3.Shapes
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp

val Navy = Color(0xFF0A2540)
val Blue = Color(0xFF1261A0)
val Gold = Color(0xFFD5A021)
val Surface = Color(0xFFF6F7FA)
val Ink = Color(0xFF152238)

private val LightColors = lightColorScheme(
    primary = Navy, onPrimary = Color.White, secondary = Gold, onSecondary = Navy,
    background = Surface, onBackground = Ink, surface = Color.White, onSurface = Ink,
    primaryContainer = Color(0xFFE7EDF4), onPrimaryContainer = Navy,
    secondaryContainer = Color(0xFFFFF0C8), onSecondaryContainer = Color(0xFF614700),
    surfaceVariant = Color(0xFFEAF0F6), onSurfaceVariant = Color(0xFF657286),
    outline = Color(0xFF98A6B8), outlineVariant = Color(0xFFE1E6ED)
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFF8CC8FF), onPrimary = Color(0xFF002E52), secondary = Color(0xFFFFD36A),
    background = Color(0xFF091522), onBackground = Color(0xFFE7EEF6), surface = Color(0xFF102334), onSurface = Color(0xFFE7EEF6),
    primaryContainer = Color(0xFF213E56), onPrimaryContainer = Color(0xFFD4E9FC),
    secondaryContainer = Color(0xFF4C3B15), onSecondaryContainer = Color(0xFFFFDF97),
    surfaceVariant = Color(0xFF1A3043), onSurfaceVariant = Color(0xFFAEBFD0), outline = Color(0xFF6F8799), outlineVariant = Color(0xFF293D50)
)

private fun text(size: Int, height: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = weight, fontSize = size.sp, lineHeight = height.sp)
private val AppTypography = Typography(
    headlineLarge = text(30, 42, FontWeight.Bold), headlineMedium = text(26, 38, FontWeight.Bold), headlineSmall = text(23, 34, FontWeight.Bold),
    titleLarge = text(20, 30, FontWeight.Bold), titleMedium = text(16, 25, FontWeight.SemiBold), titleSmall = text(14, 22, FontWeight.SemiBold),
    bodyLarge = text(16, 27), bodyMedium = text(14, 23), bodySmall = text(12, 20),
    labelLarge = text(14, 22, FontWeight.SemiBold), labelMedium = text(12, 19, FontWeight.Medium), labelSmall = text(11, 17, FontWeight.Medium)
)

@Composable
fun AqartkomTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, typography = AppTypography,
        shapes = Shapes(small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(18.dp), large = RoundedCornerShape(24.dp)), content = content)
}

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

val Navy = Color(0xFF102E3D)
val Blue = Color(0xFF087E86)
val Teal = Color(0xFF087F79)
val Mint = Color(0xFFBDEEE0)
val Gold = Color(0xFFE3BC78)
val Surface = Color(0xFFF4F7F7)
val Ink = Color(0xFF182F3B)

private val LightColors = lightColorScheme(
    primary = Teal, onPrimary = Color.White, secondary = Navy, onSecondary = Color.White,
    tertiary = Color(0xFF825B24), onTertiary = Color.White,
    background = Surface, onBackground = Ink, surface = Color.White, onSurface = Ink,
    primaryContainer = Color(0xFFDDF3EB), onPrimaryContainer = Color(0xFF064E49),
    secondaryContainer = Color(0xFFE5EDF2), onSecondaryContainer = Navy,
    tertiaryContainer = Color(0xFFFFEBCD), onTertiaryContainer = Color(0xFF614218),
    surfaceVariant = Color(0xFFECF2F2), onSurfaceVariant = Color(0xFF536971),
    outline = Color(0xFF789098), outlineVariant = Color(0xFFDDE7E7)
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFF88DCC9), onPrimary = Color(0xFF003C35), secondary = Color(0xFFB6CEDD), onSecondary = Navy,
    tertiary = Gold, onTertiary = Color(0xFF422D0F),
    background = Color(0xFF0D1B23), onBackground = Color(0xFFE5EFEE), surface = Color(0xFF142831), onSurface = Color(0xFFE5EFEE),
    primaryContainer = Color(0xFF184A44), onPrimaryContainer = Color(0xFFBEF3E4),
    secondaryContainer = Color(0xFF263D4B), onSecondaryContainer = Color(0xFFDBEAF2),
    tertiaryContainer = Color(0xFF493A24), onTertiaryContainer = Color(0xFFFFDFAC),
    surfaceVariant = Color(0xFF213840), onSurfaceVariant = Color(0xFFB1C5C9), outline = Color(0xFF839EA4), outlineVariant = Color(0xFF304951)
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
        shapes = Shapes(extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(14.dp), medium = RoundedCornerShape(20.dp), large = RoundedCornerShape(28.dp), extraLarge = RoundedCornerShape(32.dp)), content = content)
}

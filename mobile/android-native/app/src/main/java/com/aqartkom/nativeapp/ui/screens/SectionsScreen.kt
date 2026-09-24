package com.aqartkom.nativeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalLayoutDirection
import com.aqartkom.nativeapp.R
import com.aqartkom.nativeapp.ui.*

@Composable
fun SectionsScreen(modifier: Modifier, onProperties: () -> Unit, onHotels: () -> Unit, onAccount: () -> Unit, onServices: () -> Unit, onSol: () -> Unit, darkMode: Boolean, onDarkMode: () -> Unit) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(300.dp),
            modifier = Modifier.widthIn(max = 1040.dp).fillMaxSize(),
            contentPadding = PaddingValues(20.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BrandMark()
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text("عقارتكم", style = MaterialTheme.typography.titleLarge)
                        Text("عقار وإقامة في سوريا", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onDarkMode) { Icon(if (darkMode) Icons.Default.LightMode else Icons.Default.DarkMode, "تغيير المظهر") }
                    FilledTonalIconButton(onAccount) { Icon(Icons.Default.PersonOutline, "حسابي") }
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("أهلًا بك،", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                    Text("مكانك القادم يبدأ هنا", style = MaterialTheme.typography.headlineMedium)
                    Text("اكتشف عقارك، أو خطّط لإقامة تستحقها.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item {
                Surface(onClick = onProperties, shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Column {
                        Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant)) {
                            Image(painterResource(R.drawable.syria_panorama), "رسم لمعالم سوريا والمباني السكنية", Modifier.fillMaxWidth().aspectRatio(3f), contentScale = ContentScale.Crop)
                        }
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                FeatureIcon(Icons.Default.HomeWork)
                                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                    Text("العقارات", style = MaterialTheme.typography.titleLarge)
                                    Text("شراء • إيجار • استثمار", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            SectionAction("استكشف العقارات", MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
            item {
                Surface(onClick = onHotels, shape = RoundedCornerShape(28.dp), color = Navy, contentColor = Color.White) {
                    Column(Modifier.background(Brush.linearGradient(listOf(Navy, Color(0xFF165A5C)))).padding(22.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            FeatureIcon(Icons.Default.Hotel, background = Color.White.copy(alpha = .12f), tint = Mint)
                            Spacer(Modifier.weight(1f))
                            Surface(color = Color.White.copy(alpha = .12f), contentColor = Mint, shape = RoundedCornerShape(50)) {
                                Text("إقامتك القادمة", Modifier.padding(horizontal = 12.dp, vertical = 6.dp), style = MaterialTheme.typography.labelMedium)
                            }
                        }
                        Text("إقامة تستحقها", style = MaterialTheme.typography.headlineMedium)
                        Text("فنادق وشقق مفروشة ومزارع،\nلتختار المكان الذي يشبهك.", style = MaterialTheme.typography.bodyMedium, color = Color(0xFFD1E5E4))
                        HorizontalDivider(color = Color.White.copy(alpha = .18f))
                        SectionAction("استكشف الفنادق واحجز", Mint)
                    }
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Surface(onClick = onSol, color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(24.dp)) {
                    Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        FeatureIcon(Icons.Default.AutoAwesome, background = MaterialTheme.colorScheme.surface, tint = MaterialTheme.colorScheme.primary)
                        Column(Modifier.weight(1f)) {
                            Text("دع سول يساعدك", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Text("اسأل، قارن، واكتشف خياراتك", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                        Icon(Icons.Default.ChevronLeft, null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
                }
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                OutlinedButton(onServices, Modifier.fillMaxWidth().heightIn(min = 54.dp), shape = RoundedCornerShape(18.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Icon(Icons.Default.GridView, null, Modifier.size(20.dp))
                    Text("الخدمات ولوحات الإدارة", Modifier.weight(1f).padding(horizontal = 12.dp))
                    Icon(Icons.Default.ChevronLeft, null, Modifier.size(20.dp))
                }
            }
        }
    }
}

@Composable
private fun SectionAction(label: String, color: Color) {
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = color, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        Icon(Icons.Default.ArrowBack, null, tint = color, modifier = Modifier.size(20.dp))
    }
}

@Preview(name = "البداية — فاتح", widthDp = 393, heightDp = 900, showBackground = true)
@Composable
private fun SectionsLightPreview() { SectionsPreview(false) }

@Preview(name = "البداية — ليلي", widthDp = 393, heightDp = 900, showBackground = true)
@Composable
private fun SectionsDarkPreview() { SectionsPreview(true) }

@Composable
private fun SectionsPreview(dark: Boolean) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        AqartkomTheme(dark) { Surface(color = MaterialTheme.colorScheme.background) {
            SectionsScreen(Modifier, {}, {}, {}, {}, {}, dark, {})
        } }
    }
}

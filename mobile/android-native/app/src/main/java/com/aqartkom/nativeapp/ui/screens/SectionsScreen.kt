package com.aqartkom.nativeapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
fun SectionsScreen(modifier: Modifier, onProperties: () -> Unit, onHotels: () -> Unit, onAccount: () -> Unit) {
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Spacer(Modifier.height(20.dp))
        Text("عقارتكم", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("عقارك وإقامتك في مكان واحد", style = MaterialTheme.typography.titleMedium)
        Text("اختر القسم الذي تريد استكشافه", color = MaterialTheme.colorScheme.onSurfaceVariant)
        SectionCard("العقارات", "بيع وشراء وإيجار العقارات", "تصفح الإعلانات، ابحث على الخريطة، وتواصل مع المعلن أو أضف عقارك.", "استكشف العقارات", Icons.Default.Apartment, onProperties)
        SectionCard("الفنادق والحجوزات", "ابحث عن إقامتك القادمة", "استعرض الفنادق والغرف، اختر التواريخ، وراجع السعر والتوفر قبل تأكيد الحجز.", "استكشف الفنادق واحجز", Icons.Default.Hotel, onHotels)
        TextButton(onAccount, Modifier.fillMaxWidth()) { Icon(Icons.Default.PersonOutline, null); Spacer(Modifier.width(8.dp)); Text("حسابي") }
    }
}

@Composable
private fun SectionCard(title: String, subtitle: String, description: String, action: String, icon: ImageVector, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(subtitle, style = MaterialTheme.typography.titleMedium)
            Text(description, style = MaterialTheme.typography.bodyMedium)
            Text(action + " ←", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
        }
    }
}

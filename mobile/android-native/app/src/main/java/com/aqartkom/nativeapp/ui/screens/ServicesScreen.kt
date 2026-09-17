package com.aqartkom.nativeapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.History
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aqartkom.nativeapp.data.SiteAccess
import com.aqartkom.nativeapp.data.User

@Composable
fun ServicesScreen(modifier: Modifier, user: User?, open: (String) -> Unit, history: () -> Unit) {
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("الخدمات ولوحات القيادة", style = MaterialTheme.typography.headlineSmall)
        Text("خدمات الموقع محدثة داخل تطبيقك. تظهر أدوات الإدارة بحسب صلاحيات الحساب.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        SiteAccess.services(user).forEach { item ->
            Card(onClick = { open(item.path) }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(item.title, style = MaterialTheme.typography.titleMedium)
                        Text(item.detail, style = MaterialTheme.typography.bodySmall)
                    }
                    Icon(Icons.Default.ChevronLeft, null)
                }
            }
        }
        OutlinedButton(history, Modifier.fillMaxWidth()) { Icon(Icons.Default.History, null); Spacer(Modifier.width(8.dp)); Text("حجوزات النسخ السابقة على هذا الجهاز") }
        Text("سول يحتاج تنزيل النموذج مرة واحدة. الحجوزات والدفع والتعديلات تحتاج اتصالًا.", style = MaterialTheme.typography.bodySmall)
    }
}

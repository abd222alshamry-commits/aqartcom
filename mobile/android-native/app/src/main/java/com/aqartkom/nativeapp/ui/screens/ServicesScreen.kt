package com.aqartkom.nativeapp.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.aqartkom.nativeapp.data.SiteAccess
import com.aqartkom.nativeapp.data.User
import com.aqartkom.nativeapp.ui.FeatureIcon

@Composable
fun ServicesScreen(modifier: Modifier, user: User?, open: (String) -> Unit, history: () -> Unit) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(Modifier.widthIn(max = 760.dp).fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Column(Modifier.padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("كل ما تحتاجه", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text("خدماتك في مكان واحد", style = MaterialTheme.typography.headlineSmall)
                    Text("اكتشف الخدمات وأدوات إدارة حسابك.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            // SiteAccess remains the single source for role and permission filtering.
            items(SiteAccess.services(user), key = { it.path }) { item ->
                val sol = item.path == "/sol.html"
                Surface(
                    onClick = { open(item.path) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp),
                    color = if (sol) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
                    border = if (sol) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(13.dp)) {
                        FeatureIcon(serviceIcon(item.path), background = if (sol) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant, tint = MaterialTheme.colorScheme.primary)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(item.title, style = MaterialTheme.typography.titleSmall)
                            Text(item.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Icon(Icons.Default.ChevronLeft, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item {
                OutlinedButton(history, Modifier.fillMaxWidth().heightIn(min = 54.dp), shape = RoundedCornerShape(18.dp)) {
                    Icon(Icons.Default.History, null)
                    Spacer(Modifier.width(8.dp))
                    Text("الحجوزات المحفوظة في هذا التطبيق")
                }
            }
            item {
                Text("سول يحتاج تنزيل النموذج مرة واحدة. الحجوزات والدفع والتعديلات تحتاج اتصالًا.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private fun serviceIcon(path: String): ImageVector = when (path) {
    "/sol.html" -> Icons.Default.AutoAwesome
    "/hotels.html" -> Icons.Default.Hotel
    "/host-portal.html" -> Icons.Default.Key
    "/request-property.html" -> Icons.Default.AddHome
    "/request-dashboard.html" -> Icons.Default.Assignment
    "/messages.html" -> Icons.Default.Forum
    "/office.html" -> Icons.Default.Storefront
    "/admin.html" -> Icons.Default.Dashboard
    "/hotel-partner.html" -> Icons.Default.Business
    "/offer-review.html" -> Icons.Default.FactCheck
    "/admin-team.html" -> Icons.Default.AdminPanelSettings
    else -> Icons.Default.Language
}

package com.aqartkom.nativeapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aqartkom.nativeapp.HotelsViewModel
import com.aqartkom.nativeapp.data.SiteAccess

/** Read older native receipts without exposing the superseded booking flow. */
@Composable
fun LegacyBookingsScreen(modifier: Modifier, vm: HotelsViewModel, open: (String) -> Unit, back: () -> Unit) {
    val rows by vm.history.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.clearMessage() } }
    BackHandler { if (!busy) back() }
    Box(modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(back, enabled = !busy) { Icon(Icons.Default.ArrowForward, "العودة إلى الخدمات") }
                    Text("سجل الحجوزات السابق", style = MaterialTheme.typography.titleLarge)
                }
                Text("حجوزات محفوظة من واجهات التطبيق السابقة. افتح الحجز لتحديث حالته وإدارته.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (pending != null) item {
                Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("طلب سابق يحتاج التحقق", style = MaterialTheme.typography.titleMedium)
                        Text("استرجع نتيجة الطلب نفسه قبل إنشاء حجز آخر، لتجنب تكراره.")
                        Button({ vm.submit("", "", "", "") }, enabled = !busy) { Text(if (busy) "جارٍ التحقق…" else "استعادة نتيجة الطلب") }
                    }
                }
            }
            item { FilledTonalButton({ open("/hotels.html#bookings") }, Modifier.fillMaxWidth(), enabled = !busy && pending == null) { Text("حجوزاتي في النظام الجديد") } }
            if (rows.isEmpty()) item { Text("لا توجد حجوزات سابقة محفوظة هنا.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(rows, key = { it.code }) { receipt ->
                Surface(onClick = { SiteAccess.bookingPath(receipt.code)?.let(open) }, enabled = !busy, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(receipt.hotel, style = MaterialTheme.typography.titleMedium)
                        Text(receipt.code, color = MaterialTheme.colorScheme.primary)
                        Text("${receipt.checkIn} ← ${receipt.checkOut}", style = MaterialTheme.typography.bodySmall)
                        Text("عرض الحالة الحالية والتفاصيل ←", style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

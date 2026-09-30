package com.aqartkom.nativeapp.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aqartkom.nativeapp.data.BookingNotifications

@Composable
fun BookingNotificationsScreen(onBack: () -> Unit, openInbox: () -> Unit) {
    val context = LocalContext.current
    var enabled by remember { mutableStateOf(BookingNotifications.enabled(context) && BookingNotifications.permitted(context)) }
    var message by remember { mutableStateOf("") }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) { BookingNotifications.enable(context); enabled = true }
        else message = "لم يُسمح بإشعارات الهاتف. تبقى جميع الطلبات في صندوق الإشعارات داخل التطبيق."
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        TextButton(onBack) { Text("العودة") }
        Text("إشعارات الحجوزات", style = MaterialTheme.typography.headlineSmall)
        Text("ستجد طلبات الحجز وردود الفندق في صندوق إشعارات حسابك. افتح الطلب لقبوله أو رفضه من إدارة الفندق.")
        Button(openInbox, Modifier.fillMaxWidth()) { Text("فتح صندوق الإشعارات") }
        Text("إشعارات الهاتف", style = MaterialTheme.typography.titleLarge)
        Text("يفحص التطبيق الطلبات أثناء استخدامه، ودوريًا في الخلفية كل 15 دقيقة تقريبًا. قد تتأخر التنبيهات بسبب الإنترنت أو توفير البطارية. يمكنك مراجعة الطلبات في أي وقت من الصندوق.")
        Switch(checked = enabled, onCheckedChange = { value ->
            if (!value) { BookingNotifications.disable(context); enabled = false }
            else if (Build.VERSION.SDK_INT >= 33 && !BookingNotifications.permitted(context)) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            else if (!BookingNotifications.permitted(context)) message = "فعّل إشعارات عقارتكم من إعدادات الهاتف."
            else { BookingNotifications.enable(context); enabled = true }
        })
        if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.error)
    }
}

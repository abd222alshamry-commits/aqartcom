package com.aqartkom.nativeapp.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aqartkom.nativeapp.SiteActivity
import com.aqartkom.nativeapp.HotelsViewModel
import com.aqartkom.nativeapp.data.*
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

@Composable
fun HotelManagementScreen(modifier: Modifier, vm: HotelsViewModel, user: User?, admin: Boolean, onBack: () -> Unit, onAccount: () -> Unit) {
    val context = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    var openError by remember { mutableStateOf<String?>(null) }
    val state by produceState<LoadState<JSONObject>>(LoadState.Loading, user?.id, user?.role, user?.adminPermissions, admin, refresh) {
        value = LoadState.Loading
        if (user == null || (admin && !SiteAccess.can(user, "hotels.read"))) return@produceState
        value = try { LoadState.Ready(vm.management(admin)) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { LoadState.Error(e.message ?: "تعذر تحميل الفنادق") }
    }
    fun openDashboard() {
        val path = if (admin) "/admin.html" else "/hotel-partner.html"
        try { context.startActivity(Intent(context, SiteActivity::class.java).putExtra("path", path)) }
        catch (_: Exception) { openError = "تعذر فتح لوحة الإدارة" }
    }
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            TextButton(onBack) { Text("العودة إلى الفنادق") }
            Text(if (admin) "إدارة الفنادق" else "شركاء الفنادق", style = MaterialTheme.typography.headlineSmall)
            Text(if (admin) "فنادق المنصة وحجوزاتها خلال آخر 30 يومًا" else "الفنادق المرتبطة بحساب الشريك، بما فيها التي تنتظر النشر")
        }
        if (user == null) {
            item { Text("سجّل الدخول بحساب الإدارة أو الشريك لعرض الفنادق المرتبطة به."); Button(onAccount) { Text("تسجيل الدخول") } }
        } else if (admin && !SiteAccess.can(user, "hotels.read")) {
            item { Text("هذا الحساب لا يملك صلاحية إدارة المنصة."); TextButton(onAccount) { Text("مراجعة الحساب") } }
        } else {
            item {
                Text(user.name + " • " + user.email, style = MaterialTheme.typography.bodySmall)
                OutlinedButton({ refresh++ }, enabled = state !is LoadState.Loading) { Text("تحديث الفنادق") }
            }
            when (val result = state) {
                LoadState.Loading -> item { CircularProgressIndicator() }
                is LoadState.Error -> item {
                    Text(result.message, color = MaterialTheme.colorScheme.error)
                    Text("حساب الشريك يحتاج إلى صلاحية مكتب وارتباط بالمكتب المالك للفندق. الفنادق المنشورة للتصفح لا تصبح ملكًا للحساب تلقائيًا.", style = MaterialTheme.typography.bodySmall)
                    TextButton(onAccount) { Text("مراجعة الحساب") }
                }
                is LoadState.Ready -> {
                    val data = result.value
                    val rows = data.optJSONArray(if (admin) "hotels" else "data")
                    if (admin) item {
                        val k = data.optJSONObject("kpis") ?: JSONObject()
                        Text("الفنادق: ${k.optInt("hotels")} • الحجوزات: ${k.optInt("bookings")}", style = MaterialTheme.typography.titleMedium)
                    }
                    if (rows == null || rows.length() == 0) item { Text(if (admin) "لا توجد فنادق مسجلة" else "لا توجد فنادق مرتبطة بهذا الحساب بعد. يمكنك إضافة فندق من لوحة الشريك.") }
                    else items(rows.length()) { index ->
                        val hotel = rows.getJSONObject(index)
                        Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp)) {
                            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(hotel.optString("name"), style = MaterialTheme.typography.titleMedium)
                                Text(hotel.optString("city"))
                                Text("الحجوزات" + (if (admin) " خلال الفترة: " else " المفتوحة: ") + hotel.optInt(if (admin) "bookings" else "open_bookings"))
                                if (!admin) {
                                    Text("أنواع الغرف: ${hotel.optInt("room_types")}")
                                    Text("الحالة: " + when (hotel.optString("status")) { "active" -> "منشور"; "pending" -> "بانتظار المراجعة"; "inactive" -> "غير نشط"; else -> hotel.optString("status") })
                                }
                            }
                        }
                    }
                }
            }
            item {
                Button({ openDashboard() }, Modifier.fillMaxWidth()) { Text(if (admin) "فتح لوحة الإدارة الكاملة" else "إضافة فندق وإدارة الغرف والحجوزات") }
                Text("تفتح اللوحة داخل التطبيق باستخدام حسابك الحالي.", style = MaterialTheme.typography.bodySmall)
                openError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        }
    }
}

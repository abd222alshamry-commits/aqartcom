package com.aqartkom.nativeapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.activity.compose.BackHandler
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aqartkom.nativeapp.AppViewModel
import com.aqartkom.nativeapp.data.User

@Composable
fun AccountScreen(modifier: Modifier, viewModel: AppViewModel, user: User?, busy: Boolean, favoriteCount: Int, compareCount: Int, darkMode: Boolean, toggleDarkMode: () -> Unit, onFavorites: () -> Unit, onCompare: () -> Unit, onProperties: () -> Unit, onInquiries: () -> Unit, onAdd: () -> Unit, onHotels: () -> Unit, onServices: () -> Unit, onSol: () -> Unit) {
    var auth by rememberSaveable { mutableStateOf(false) }
    if (auth && user == null) {
        BackHandler { auth = false }
        Column(modifier.fillMaxSize()) { TextButton({ auth = false }, Modifier.padding(horizontal = 16.dp)) { Icon(Icons.Default.ArrowForward, null); Text("حسابي") }; AuthScreen(Modifier.weight(1f), viewModel, busy) { auth = false } }
        return
    }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        SectionHeading("حسابك في عقارتكم", "كل ما تحتاجه في مكان واحد")
        Spacer(Modifier.height(20.dp))
        Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.primaryContainer) {
            Column(Modifier.fillMaxWidth().padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.primary) { Icon(Icons.Default.PersonOutline, null, Modifier.padding(14.dp).size(30.dp), tint = MaterialTheme.colorScheme.onPrimary) }
                    Column(Modifier.weight(1f).padding(start = 14.dp)) {
                        Text(user?.name ?: "أهلًا بك في عقارتكم", style = MaterialTheme.typography.titleLarge)
                        Text(user?.email ?: "سجّل الدخول لحفظ العقارات وإضافة إعلانك", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (user == null) { Spacer(Modifier.height(16.dp)); Button({ auth = true }, Modifier.fillMaxWidth().height(48.dp)) { Text("تسجيل الدخول أو إنشاء حساب") } }
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { StatCard("المفضلة", favoriteCount.toString(), Icons.Default.FavoriteBorder, Modifier.weight(1f).clickable(onClick = onFavorites)); StatCard("للمقارنة", compareCount.toString(), Icons.Default.CompareArrows, Modifier.weight(1f).clickable(onClick = onCompare)) }
        Spacer(Modifier.height(20.dp))
        Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.padding(horizontal = 16.dp)) {
                ProfileItem("العقارات المحفوظة", "عد إلى اختياراتك المفضلة", Icons.Default.FavoriteBorder, onFavorites)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ProfileItem("مقارنة العقارات", "قارن السعر والمساحة والموقع", Icons.Default.CompareArrows, onCompare)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ProfileItem("عقاراتي", "إعلاناتك وصورها وحالة نشرها", Icons.Default.Apartment) { if (user == null) auth = true else onProperties() }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ProfileItem("طلبات التواصل", "الاستفسارات الواردة على إعلاناتك", Icons.Default.Forum) { if (user == null) auth = true else onInquiries() }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ProfileItem("الفنادق والحجوزات", "الفنادق والشقق والمزارع والحجوزات والدفع", Icons.Default.Hotel, onHotels)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ProfileItem("الخدمات والإدارة", "لوحات المستضيفين والمكاتب والمشرفين", Icons.Default.Dashboard, onServices)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ProfileItem("سول — مساعدك الخاص", "ذاكرة وتفضيلات ومقارنة العروض", Icons.Default.AutoAwesome, onSol)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                ProfileItem("أضف عقارًا", "اعرض عقارك بالصور والفيديو", Icons.Default.AddHome) { if (user == null) auth = true else onAdd() }
            }
        }
        Spacer(Modifier.height(16.dp))
        ProfileItem(if (darkMode) "الوضع النهاري" else "الوضع الليلي", "احفظ المظهر الذي يناسبك", if (darkMode) Icons.Default.LightMode else Icons.Default.DarkMode, toggleDarkMode)
        if (user != null) { Spacer(Modifier.height(10.dp)); OutlinedButton(viewModel::logout, Modifier.fillMaxWidth().height(50.dp), enabled = !busy) { Icon(Icons.Default.Logout, null); Spacer(Modifier.width(8.dp)); Text("تسجيل الخروج") } }
        Spacer(Modifier.height(20.dp)); Text("عقارتكم • الإصدار ${com.aqartkom.nativeapp.BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun AuthScreen(modifier: Modifier, viewModel: AppViewModel, busy: Boolean, done: () -> Unit) {
    var register by remember { mutableStateOf(false) }; var name by remember { mutableStateOf("") }; var email by remember { mutableStateOf("") }; var phone by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(shape = RoundedCornerShape(26.dp), color = MaterialTheme.colorScheme.primary) { Icon(Icons.Default.HomeWork, null, Modifier.padding(18.dp).size(42.dp), tint = MaterialTheme.colorScheme.onPrimary) }
        Spacer(Modifier.height(14.dp)); Text(if (register) "أنشئ حسابك" else "مرحبًا بعودتك", fontSize = 28.sp, fontWeight = FontWeight.Black)
        Text(if (register) "انضم إلى مجتمع عقارتكم" else "سجّل الدخول لإدارة عقاراتك ومفضّلتك", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(26.dp))
        if (register) { OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("الاسم الكامل") }, leadingIcon = { Icon(Icons.Default.Person, null) }, singleLine = true); Spacer(Modifier.height(10.dp)) }
        OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("البريد الإلكتروني") }, leadingIcon = { Icon(Icons.Default.Email, null) }, singleLine = true)
        if (register) { Spacer(Modifier.height(10.dp)); OutlinedTextField(phone, { phone = it }, Modifier.fillMaxWidth(), label = { Text("رقم الهاتف") }, leadingIcon = { Icon(Icons.Default.Call, null) }, singleLine = true) }
        Spacer(Modifier.height(10.dp)); OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("كلمة المرور") }, leadingIcon = { Icon(Icons.Default.Lock, null) }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
        Spacer(Modifier.height(18.dp)); Button({ viewModel.authenticate(register,name,email,phone,password,done) }, Modifier.fillMaxWidth().height(54.dp), enabled = !busy) { if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) else Text(if (register) "إنشاء الحساب" else "تسجيل الدخول") }
        TextButton({ register = !register }) { Text(if (register) "لديك حساب؟ سجّل الدخول" else "ليس لديك حساب؟ أنشئ حسابًا") }
    }
}

@Composable private fun StatCard(label: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier) { Surface(modifier, color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(20.dp)) { Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(icon, null, tint = MaterialTheme.colorScheme.primary); Text(value, fontWeight = FontWeight.Black, fontSize = 22.sp); Text(label, style = MaterialTheme.typography.bodySmall) } } }
@Composable private fun ProfileItem(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) { Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) { Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(14.dp)) { Icon(icon, null, Modifier.padding(11.dp), tint = MaterialTheme.colorScheme.primary) }; Spacer(Modifier.width(12.dp)); Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Bold); Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Icon(Icons.Default.ChevronLeft, null, tint = MaterialTheme.colorScheme.outline) } }

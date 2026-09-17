package com.aqartkom.nativeapp.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aqartkom.nativeapp.ui.VideoThumbnail
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aqartkom.nativeapp.AppViewModel
import com.aqartkom.nativeapp.data.PropertyDraft
import com.aqartkom.nativeapp.data.User
import coil.compose.AsyncImage

@Composable
fun AddPropertyScreen(modifier: Modifier, viewModel: AppViewModel, user: User?, busy: Boolean, onLogin: () -> Unit, done: () -> Unit) {
    if (user == null) {
        Column(modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Lock, null, Modifier.size(60.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(14.dp)); Text("سجّل الدخول لإضافة عقارك", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("احفظ بيانات إعلانك وارفع صوره وفيديوهاته من حسابك.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(18.dp)); Button(onLogin, Modifier.fillMaxWidth().height(52.dp)) { Text("الانتقال إلى حسابي") }
        }
        return
    }
    val context = LocalContext.current
    val progress by viewModel.uploadProgress.collectAsStateWithLifecycle()
    val editable = !busy && !progress.savedProperty
    var images by rememberSaveable(stateSaver = UriListSaver) { mutableStateOf<List<Uri>>(emptyList()) }
    var videos by rememberSaveable(stateSaver = UriListSaver) { mutableStateOf<List<Uri>>(emptyList()) }
    fun keepAccess(picked: List<Uri>) {
        picked.forEach { uri -> runCatching { context.contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) } }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(12)) { picked -> keepAccess(picked); images = (images + picked).distinct().take(12) }
    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(3)) { picked -> keepAccess(picked); videos = (videos + picked).distinct().take(3) }
    var title by rememberSaveable { mutableStateOf("") }; var type by rememberSaveable { mutableStateOf("شقة") }; var mode by rememberSaveable { mutableStateOf("بيع") }
    var city by rememberSaveable { mutableStateOf("دمشق") }; var district by rememberSaveable { mutableStateOf("") }; var price by rememberSaveable { mutableStateOf("") }; var currency by rememberSaveable { mutableStateOf("USD") }
    var area by rememberSaveable { mutableStateOf("") }; var rooms by rememberSaveable { mutableStateOf("") }; var baths by rememberSaveable { mutableStateOf("") }; var description by rememberSaveable { mutableStateOf("") }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("أضف عقارك", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
        Text("أدخل تفاصيل دقيقة وصورًا واضحة لتحصل على تواصل أفضل.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("عنوان الإعلان*") }, singleLine = true, enabled = editable)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { Box(Modifier.weight(1f)) { ChoiceRow("النوع", listOf("شقة","منزل","فيلا","أرض","محل تجاري","مكتب","بناء","مزرعة"), type, enabled = editable) { type = it } }; Box(Modifier.weight(1f)) { ChoiceRow("العملية", listOf("بيع","إيجار"), mode, enabled = editable) { mode = it } } }
        ChoiceRow("المحافظة", com.aqartkom.nativeapp.data.SyrianCities, city, enabled = editable) { city = it }
        OutlinedTextField(district, { district = it }, Modifier.fillMaxWidth(), label = { Text("المدينة أو الحي") }, singleLine = true, enabled = editable)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { OutlinedTextField(price, { price = it }, Modifier.weight(1f), label = { Text("السعر*") }, singleLine = true, enabled = editable); Box(Modifier.width(120.dp)) { ChoiceRow("العملة", listOf("USD","SYP","SAR","EUR","AED"), currency, enabled = editable) { currency = it } } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedTextField(area, { area = it }, Modifier.weight(1f), label = { Text("المساحة م²") }, singleLine = true, enabled = editable); OutlinedTextField(rooms, { rooms = it }, Modifier.weight(1f), label = { Text("الغرف") }, singleLine = true, enabled = editable); OutlinedTextField(baths, { baths = it }, Modifier.weight(1f), label = { Text("الحمامات") }, singleLine = true, enabled = editable) }
        OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth().height(130.dp), label = { Text("وصف العقار") }, enabled = editable)
        Text("صور وفيديو العقار", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(onClick = { imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, Modifier.weight(1f).height(58.dp), enabled = editable) { Icon(Icons.Default.AddPhotoAlternate, null); Spacer(Modifier.width(6.dp)); Text("الصور (${images.size}/12)") }
            OutlinedButton(onClick = { videoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)) }, Modifier.weight(1f).height(58.dp), enabled = editable) { Icon(Icons.Default.VideoLibrary, null); Spacer(Modifier.width(6.dp)); Text("الفيديو (${videos.size}/3)") }
        }
        if (images.isNotEmpty() || videos.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(9.dp), contentPadding = PaddingValues(vertical = 3.dp)) {
                items(images, key = { "image-$it" }) { uri -> MediaPreview(uri, false) { if (editable) images = images - uri } }
                items(videos, key = { "video-$it" }) { uri -> MediaPreview(uri, true) { if (editable) videos = videos - uri } }
            }
        }
        Text("تعرض بطاقة الفيديو لقطة حقيقية منه. الحد الأقصى 12 صورة و3 فيديوهات بصيغة MP4 أو MOV أو WebM.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (progress.savedProperty || progress.error != null) {
            Text(if (progress.savedProperty) "الإعلان محفوظ • تم رفع ${progress.uploaded} من ${progress.total} ملفًا" else "لم يُرسل الإعلان بعد", fontWeight = FontWeight.Bold)
            if (busy && progress.total > 0) LinearProgressIndicator(progress = { progress.uploaded.toFloat() / progress.total }, modifier = Modifier.fillMaxWidth())
            progress.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (progress.savedProperty && !busy) Text("أعد المحاولة لإكمال الملفات المتبقية على الإعلان نفسه.", style = MaterialTheme.typography.bodySmall)
        }
        Button(
            onClick = {
                if (title.isBlank() || city.isBlank() || price.toDoubleOrNull() == null) { viewModel.showMessage("أكمل العنوان والمحافظة والسعر") }
                else viewModel.createProperty(PropertyDraft(title,type,mode,city,district,price,currency,area,rooms,baths,description), context.contentResolver, images + videos) { done() }
            }, enabled = !busy, modifier = Modifier.fillMaxWidth().height(56.dp)
        ) { if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) else Icon(Icons.Default.CheckCircle, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "جارٍ الحفظ والرفع…" else if (progress.savedProperty) "إعادة رفع الملفات المتبقية" else "حفظ الإعلان ورفع الملفات") }
        if (progress.savedProperty && progress.error != null && !busy) {
            TextButton(onClick = { viewModel.finishPartialSubmission(done) }) { Text("إنهاء الإعلان بالمرفقات التي نجحت فقط") }
        }
        Spacer(Modifier.height(22.dp))
    }
}

@Composable
private fun MediaPreview(uri: Uri, video: Boolean, remove: () -> Unit) {
    Box(Modifier.size(width = 122.dp, height = 92.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
        if (video) VideoThumbnail(uri.toString(), Modifier.fillMaxSize()) else AsyncImage(uri, "صورة مختارة", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        if (video) Icon(Icons.Default.PlayCircle, "فيديو", Modifier.align(Alignment.Center).size(34.dp), tint = Color.White)
        IconButton(remove, Modifier.align(Alignment.TopEnd).size(30.dp).background(Color.Black.copy(.62f), RoundedCornerShape(bottomStart = 12.dp))) { Icon(Icons.Default.Close, "حذف", Modifier.size(18.dp), tint = Color.White) }
    }
}

private val UriListSaver = listSaver<List<Uri>, String>(save = { list -> list.map(Uri::toString) }, restore = { list -> list.map(Uri::parse) })

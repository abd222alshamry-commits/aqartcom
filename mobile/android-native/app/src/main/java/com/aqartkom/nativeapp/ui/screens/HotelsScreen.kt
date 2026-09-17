package com.aqartkom.nativeapp.ui.screens

import android.app.DatePickerDialog
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.aqartkom.nativeapp.HotelPage
import com.aqartkom.nativeapp.HotelsViewModel
import com.aqartkom.nativeapp.data.*
import com.aqartkom.nativeapp.ui.Gold
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.text.NumberFormat
import java.util.Locale

@Composable
fun HotelsScreen(modifier: Modifier, vm: HotelsViewModel, user: User?) {
    val page by vm.page.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val detail by vm.detail.collectAsStateWithLifecycle()
    val quote by vm.quote.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle()
    val receipt by vm.receipt.collectAsStateWithLifecycle()
    val history by vm.history.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val filters by vm.filters.collectAsStateWithLifecycle()
    val state by vm.hotels.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val pages = rememberSaveableStateHolder()
    LaunchedEffect(Unit) { vm.ensureLoaded() }
    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.clearMessage() } }
    BackHandler(page != HotelPage.Search, vm::back)
    Box(modifier.fillMaxSize()) {
        Column {
            Surface(color = MaterialTheme.colorScheme.surface) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (page != HotelPage.Search) IconButton(vm::back, enabled = !busy) { Icon(Icons.Default.ArrowForward, "رجوع") }
                    else Icon(Icons.Default.Hotel, null, Modifier.padding(10.dp).size(28.dp), tint = MaterialTheme.colorScheme.primary)
                    Column(Modifier.weight(1f)) { Text(when (page) { HotelPage.Search -> "الفنادق والحجوزات"; HotelPage.Detail -> "الفندق والغرف"; HotelPage.Booking -> "مراجعة الحجز"; HotelPage.Receipt -> "تفاصيل الحجز"; HotelPage.History -> "حجوزات هذا الجهاز" }, style = MaterialTheme.typography.titleLarge); if (page == HotelPage.Search) Text("اختر وجهتك وإقامتك القادمة", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (page == HotelPage.Search) TextButton(vm::history) { Text("حجوزاتي") }
                }
            }
            pages.SaveableStateProvider(if (page == HotelPage.Search) "hotel-search" else "${page.name}-${(detail as? LoadState.Ready)?.value?.hotel?.id.orEmpty()}") {
                when (page) {
                    HotelPage.Search -> HotelSearchContent(state, filters, pending != null, vm::search, vm::openHotel, vm::resumePending)
                    HotelPage.Detail -> when (val value = detail) {
                        LoadState.Loading -> LoadingPane()
                        is LoadState.Error -> ErrorPane(value.message, vm::retryDetail)
                        is LoadState.Ready -> HotelDetailContent(value.value, filters, vm::chooseRoom)
                    }
                    HotelPage.Booking -> when (val value = quote) {
                        LoadState.Loading -> LoadingPane()
                        is LoadState.Error -> ErrorPane(value.message, vm::retryQuote)
                        is LoadState.Ready -> BookingContent(value.value, pending, busy, user, vm::submit, vm::retryQuote)
                    }
                    HotelPage.Receipt -> receipt?.let { ReceiptContent(it, busy, vm::refreshReceipt, vm::cancelReceipt) }
                    HotelPage.History -> LazyColumn(contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        item { Text("الحجوزات التي أكملتها من هذا الجهاز. الحالة المعروضة هي آخر تأكيد محفوظ.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (history.isEmpty()) item { EmptyPane("لا توجد حجوزات محفوظة على هذا الجهاز") }
                        items(history, key = { it.code }) { r -> Surface(onClick = { vm.viewReceipt(r) }, shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surface) { Column(Modifier.fillMaxWidth().padding(18.dp)) { Text(r.hotel, style = MaterialTheme.typography.titleMedium); Text(r.code, color = MaterialTheme.colorScheme.primary); Text("${r.checkIn} ← ${r.checkOut}", style = MaterialTheme.typography.bodySmall); Text(hotelMoney(r.total, r.currency), fontWeight = FontWeight.Bold) } } }
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).imePadding())
    }
}

@Composable private fun HotelSearchContent(state: LoadState<List<Hotel>>, applied: HotelSearch, pending: Boolean, search: (HotelSearch) -> Unit, open: (String) -> Unit, resume: () -> Unit) {
    var query by rememberSaveable { mutableStateOf(applied.query) }
    var city by rememberSaveable { mutableStateOf(applied.city) }
    var checkIn by rememberSaveable { mutableStateOf(applied.checkIn) }
    var checkOut by rememberSaveable { mutableStateOf(applied.checkOut) }
    var adults by rememberSaveable { mutableIntStateOf(applied.adults) }
    var rooms by rememberSaveable { mutableIntStateOf(applied.rooms) }
    val rows = (state as? LoadState.Ready)?.value.orEmpty()
    LazyVerticalGrid(columns = GridCells.Adaptive(320.dp), contentPadding = PaddingValues(18.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (pending) item(span = { GridItemSpan(maxLineSpan) }) { Surface(onClick = resume, color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(16.dp)) { Column(Modifier.padding(16.dp)) { Text("طلب حجز يحتاج التحقق", fontWeight = FontWeight.Bold); Text("اضغط لمتابعة الطلب نفسه ومعرفة نتيجته", style = MaterialTheme.typography.bodySmall) } } }
        item(span = { GridItemSpan(maxLineSpan) }) {
            Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { Text("اسم الفندق أو المنطقة") }, leadingIcon = { Icon(Icons.Default.Search, null) }, singleLine = true)
                    ChoiceRow("المدينة", listOf("") + SyrianCities, city) { city = it }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        HotelDateField("الوصول", checkIn, Modifier.weight(1f)) { checkIn = it; if (checkOut <= it) checkOut = LocalDate.parse(it).plusDays(1).toString() }
                        HotelDateField("المغادرة", checkOut, Modifier.weight(1f), LocalDate.parse(checkIn).plusDays(1)) { checkOut = it }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.weight(1f)) { ChoiceRow("بالغون لكل غرفة", (1..20).map(Int::toString), adults.toString()) { adults = it.toInt() } }
                        Box(Modifier.weight(1f)) { ChoiceRow("عدد الغرف", (1..20).map(Int::toString), rooms.toString()) { rooms = it.toInt() } }
                    }
                    Button({ search(HotelSearch(query, city, checkIn, checkOut, adults, rooms)) }, Modifier.fillMaxWidth().height(52.dp)) { Icon(Icons.Default.TravelExplore, null); Spacer(Modifier.width(8.dp)); Text("ابحث عن إقامة") }
                }
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) { SectionHeading("الفنادق", if (state is LoadState.Ready) "${rows.size} نتيجة • ${applied.checkIn} إلى ${applied.checkOut}" else "حسب تواريخ الإقامة والضيوف") }
        when (state) {
            LoadState.Loading -> items(2) { PropertySkeleton() }
            is LoadState.Error -> item(span = { GridItemSpan(maxLineSpan) }) { ErrorPane(state.message) { search(applied) } }
            is LoadState.Ready -> {
                if (rows.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { EmptyPane("لا توجد فنادق متاحة بهذه الشروط. جرّب مدينة أو تواريخ أخرى.") }
                items(rows, key = { it.id }) { h -> HotelCard(h) { open(h.id) } }
            }
        }
    }
}

@Composable private fun HotelDateField(label: String, value: String, modifier: Modifier, min: LocalDate = LocalDate.now(), change: (String) -> Unit) {
    val context = LocalContext.current
    Surface(onClick = {
        val date = LocalDate.parse(value)
        DatePickerDialog(context, { _, y, m, d -> change(LocalDate.of(y, m + 1, d).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).apply { datePicker.minDate = min.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli() }.show()
    }, modifier = modifier, shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(12.dp)) { Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, style = MaterialTheme.typography.bodyMedium); Icon(Icons.Default.CalendarMonth, null, Modifier.padding(top = 5.dp).size(20.dp), tint = MaterialTheme.colorScheme.primary) }
    }
}

@Composable private fun HotelPhoto(url: String?, modifier: Modifier) {
    var failed by remember(url) { mutableStateOf(false) }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        if (!url.isNullOrBlank() && !failed) AsyncImage(url, "صورة الفندق", Modifier.fillMaxSize(), contentScale = ContentScale.Crop, onError = { failed = true })
        else Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.Hotel, null, Modifier.size(44.dp), tint = MaterialTheme.colorScheme.outline); Text("لا تتوفر صورة", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
@Composable private fun HotelCard(h: Hotel, open: () -> Unit) {
    Surface(onClick = open, shape = RoundedCornerShape(22.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), color = MaterialTheme.colorScheme.surface) {
        Column {
            HotelPhoto(h.images.firstOrNull(), Modifier.fillMaxWidth().aspectRatio(1.7f))
            Column(Modifier.padding(17.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(h.name, style = MaterialTheme.typography.titleLarge)
                Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.LocationOn, null, Modifier.size(17.dp), tint = Gold); Text(listOf(h.city, h.district).filter(String::isNotBlank).joinToString("، "), style = MaterialTheme.typography.bodySmall) }
                if (h.stars > 0) Text("★ ${h.stars} نجوم", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                Text(if (h.reviewCount > 0) "${h.reviewScore ?: "—"} • ${h.reviewCount} تقييم" else "لا توجد تقييمات منشورة بعد", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (h.description.isNotBlank()) Text(h.description, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                HorizontalDivider(Modifier.padding(vertical = 6.dp), color = MaterialTheme.colorScheme.outlineVariant)
                Text(h.minPrice?.let { "السعر الأساسي من ${hotelMoney(it, h.currency)} / ليلة" } ?: "السعر في تفاصيل الغرفة", style = MaterialTheme.typography.titleSmall)
                Text("عرض الغرف والتفاصيل ←", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable private fun HotelDetailContent(detail: HotelDetail, search: HotelSearch, choose: (HotelRoom) -> Unit) {
    val h = detail.hotel
    LazyColumn(contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item {
            val pager = rememberPagerState { h.images.size.coerceAtLeast(1) }
            Column { HorizontalPager(pager, Modifier.clip(RoundedCornerShape(22.dp))) { index -> HotelPhoto(h.images.getOrNull(index), Modifier.fillMaxWidth().aspectRatio(1.5f)) }; if (h.images.size > 1) Text("${pager.currentPage + 1} / ${h.images.size}", Modifier.align(Alignment.CenterHorizontally), style = MaterialTheme.typography.labelSmall) }
        }
        item { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(h.name, style = MaterialTheme.typography.headlineSmall); Text(listOf(h.city, h.district, h.address).filter(String::isNotBlank).joinToString("، "), color = MaterialTheme.colorScheme.onSurfaceVariant); Text(h.description.ifBlank { "لم يُضف الفندق وصفًا بعد" }); if (h.amenities.isNotEmpty()) Text(h.amenities.joinToString(" • "), style = MaterialTheme.typography.bodySmall); Text("الوصول: ${h.checkInTime} • المغادرة: ${h.checkOutTime}", style = MaterialTheme.typography.labelLarge); SectionHeading("سياسة الإلغاء"); Text(h.cancellation.ifBlank { "لم يضف الفندق سياسة إلغاء؛ راجع التفاصيل قبل التأكيد." }, style = MaterialTheme.typography.bodySmall) } }
        item { SectionHeading("أنواع الغرف", "${search.checkIn} إلى ${search.checkOut} • ${search.rooms} غرفة • ${search.adults} بالغين لكل غرفة") }
        if (detail.rooms.isEmpty()) item { EmptyPane("لا توجد غرف منشورة لهذا الفندق حاليًا") }
        items(detail.rooms, key = { it.id }) { room ->
            Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (room.images.isNotEmpty()) HotelPhoto(room.images.first(), Modifier.fillMaxWidth().height(160.dp).clip(RoundedCornerShape(14.dp)))
                    Text(room.name, style = MaterialTheme.typography.titleMedium)
                    Text("${room.type} • حتى ${room.guests} ضيوف • ${room.size?.toInt() ?: "—"} م²", style = MaterialTheme.typography.bodySmall)
                    if (room.beds.isNotBlank()) Text(room.beds, style = MaterialTheme.typography.bodySmall)
                    if (room.amenities.isNotEmpty()) Text(room.amenities.joinToString(" • "), style = MaterialTheme.typography.bodySmall)
                    if (room.description.isNotBlank()) Text(room.description, style = MaterialTheme.typography.bodySmall)
                    Text(room.price?.let { "السعر الأساسي ${hotelMoney(it, room.currency)} / ليلة" } ?: "السعر عند التحقق", fontWeight = FontWeight.Bold)
                    Button({ choose(room) }, Modifier.fillMaxWidth().height(50.dp), enabled = room.guests >= search.adults) { Text(if (room.guests >= search.adults) "تحقق من السعر والتوفر" else "السعة أقل من عدد الضيوف") }
                }
            }
        }
    }
}

@Composable private fun BookingContent(quote: HotelQuote, pending: String?, busy: Boolean, user: User?, submit: (String, String, String, String) -> Unit, refresh: () -> Unit) {
    val previous = pending?.let { JSONObject(it) }
    var name by rememberSaveable { mutableStateOf(previous?.optString("guest_name") ?: user?.name.orEmpty()) }
    var phone by rememberSaveable { mutableStateOf(previous?.optString("guest_phone") ?: user?.phone.orEmpty()) }
    var email by rememberSaveable { mutableStateOf(previous?.optString("guest_email") ?: user?.email.orEmpty()) }
    var notes by rememberSaveable { mutableStateOf(previous?.optString("special_requests").orEmpty()) }
    var accepted by rememberSaveable(quote.json) { mutableStateOf(false) }
    val editable = pending == null && !busy
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(quote.hotelName, style = MaterialTheme.typography.titleLarge); Text(quote.roomName)
                Text("${quote.checkIn} إلى ${quote.checkOut}", style = MaterialTheme.typography.bodySmall)
                Text("${quote.nights} ليلة • ${quote.rooms} غرفة", style = MaterialTheme.typography.bodySmall)
                Text(hotelMoney(quote.total, quote.currency), style = MaterialTheme.typography.headlineSmall)
                Text("الإجمالي • الدفع عند الوصول", style = MaterialTheme.typography.labelLarge)
            }
        }
        if (pending != null) Text("يوجد طلب مُرسل لم نتأكد من نتيجته. التحقق يعيد الطلب نفسه دون إنشاء حجز مكرر.", color = MaterialTheme.colorScheme.primary)
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("اسم الضيف") }, enabled = editable, singleLine = true)
        OutlinedTextField(phone, { phone = it }, Modifier.fillMaxWidth(), label = { Text("رقم الهاتف") }, enabled = editable, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
        OutlinedTextField(email, { email = it }, Modifier.fillMaxWidth(), label = { Text("البريد الإلكتروني — اختياري") }, enabled = editable, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
        OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("طلبات خاصة — اختياري") }, enabled = editable, minLines = 2, maxLines = 4)
        Text("سياسة الإلغاء", style = MaterialTheme.typography.titleMedium)
        Text(quote.policy.ifBlank { "لم يضف الفندق سياسة إلغاء تفصيلية." }, style = MaterialTheme.typography.bodySmall)
        if (pending == null) {
            TextButton(refresh, enabled = !busy) { Text("تحديث السعر والتوفر") }
            Row(Modifier.fillMaxWidth().clickable(enabled = !busy) { accepted = !accepted }, verticalAlignment = Alignment.CenterVertically) { Checkbox(accepted, { accepted = it }, enabled = !busy); Text("راجعت الفندق والتواريخ والمبلغ وسياسة الإلغاء، وأريد تأكيد الحجز بالدفع عند الوصول.", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall) }
        }
        Button({ submit(name, phone, email, notes) }, Modifier.fillMaxWidth().heightIn(min = 54.dp), enabled = !busy && (accepted || pending != null)) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
            Text(if (busy) "جارٍ التحقق…" else if (pending != null) "التحقق من الطلب" else "تأكيد الحجز والدفع عند الوصول", Modifier.padding(horizontal = 8.dp))
        }
    }
}

@Composable private fun ReceiptContent(r: HotelReceipt, busy: Boolean, onRefresh: () -> Unit, onCancel: () -> Unit) {
    var confirmCancel by rememberSaveable(r.code) { mutableStateOf(false) }
    if (confirmCancel) AlertDialog(
        onDismissRequest = { confirmCancel = false },
        title = { Text("إلغاء الحجز؟") },
        text = { Text("سيُلغى حجزك في ${r.hotel} إذا كانت مهلة الإلغاء تسمح بذلك. لا يمكن التراجع عن الإلغاء، ولا ينفّذ هذا الإجراء استردادًا ماليًا تلقائيًا.") },
        confirmButton = { TextButton(onClick = { confirmCancel = false; onCancel() }, enabled = !busy) { Text("نعم، إلغاء الحجز") } },
        dismissButton = { TextButton({ confirmCancel = false }) { Text("الاحتفاظ بالحجز") } }
    )
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(if (r.status == "confirmed") Icons.Default.CheckCircle else Icons.Default.Info, null, Modifier.size(58.dp), tint = MaterialTheme.colorScheme.primary)
        Text(if (r.status == "confirmed") "الحجز مؤكد" else when (r.status) { "cancelled" -> "الحجز ملغى"; "pending" -> "الحجز قيد الانتظار"; "completed" -> "الإقامة مكتملة"; "no_show" -> "عدم حضور"; else -> "حالة الحجز: ${r.status}" }, style = MaterialTheme.typography.headlineSmall)
        Text(r.hotel, style = MaterialTheme.typography.titleLarge); Text(r.room)
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(18.dp)) { Text(r.code, Modifier.padding(18.dp), style = MaterialTheme.typography.titleMedium) }
        OutlinedButton({ clipboard.setText(AnnotatedString(r.code)); copied = true }) { Icon(Icons.Default.ContentCopy, null); Spacer(Modifier.width(7.dp)); Text(if (copied) "تم نسخ الرقم" else "نسخ رقم الحجز") }
        Text("${r.checkIn} إلى ${r.checkOut}")
        Text(hotelMoney(r.total, r.currency), style = MaterialTheme.typography.headlineSmall)
        Text("الدفع عند الوصول • لم تُخصم دفعة إلكترونية", style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onRefresh, enabled = !busy) { Text(if (busy) "جارٍ تحديث الحجز…" else "تحديث حالة الحجز") }
        if (r.status in listOf("pending", "confirmed")) {
            val deadline = JSONObject(r.json).optString("cancellation_deadline").takeUnless { it.isBlank() || it == "null" }
            if (deadline != null) Text("مهلة الإلغاء المجاني: " + deadline.take(10), style = MaterialTheme.typography.bodySmall)
            OutlinedButton({ confirmCancel = true }, enabled = !busy, colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("إلغاء الحجز") }
            Text("يتحقق الفندق من مهلة الإلغاء عند إرسال الطلب.", style = MaterialTheme.typography.bodySmall)
        }
        Text("احتفظ برقم الحجز عند التواصل مع الفندق. يمكنك العثور عليه في حجوزات هذا الجهاز.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun hotelMoney(value: Double, currency: String): String = "${NumberFormat.getNumberInstance(Locale.US).format(value)} $currency"

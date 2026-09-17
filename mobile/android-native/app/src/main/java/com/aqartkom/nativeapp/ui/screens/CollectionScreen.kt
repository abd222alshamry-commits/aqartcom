package com.aqartkom.nativeapp.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aqartkom.nativeapp.AppViewModel
import com.aqartkom.nativeapp.data.*

enum class CollectionPage(val title: String) { Favorites("العقارات المحفوظة"), Compare("مقارنة العقارات"), MyAds("عقاراتي"), Inbox("طلبات التواصل") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(viewModel: AppViewModel, page: CollectionPage, onBack: () -> Unit, onBrowse: () -> Unit, snackbar: SnackbarHostState) {
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val compared by viewModel.comparison.collectAsStateWithLifecycle()
    val favoriteRows by viewModel.favoriteListings.collectAsStateWithLifecycle()
    val dashboard by viewModel.dashboard.collectAsStateWithLifecycle()
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, topBar = { TopAppBar(title = { Text(page.title) }, navigationIcon = { IconButton(onBack) { Icon(Icons.Default.ArrowForward, "رجوع") } }) }) { padding ->
        if (page == CollectionPage.Compare) {
            ComparisonContent(Modifier.padding(padding), compared, viewModel::toggleCompare, viewModel::openProperty, onBrowse)
        } else {
            val rowsState: LoadState<List<Property>> = if (page == CollectionPage.Favorites) favoriteRows else when (val state = dashboard) {
                LoadState.Loading -> LoadState.Loading
                is LoadState.Error -> state
                is LoadState.Ready -> LoadState.Ready(state.value.properties)
            }
            LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                when (rowsState) {
                    LoadState.Loading -> items(3) { PropertySkeleton() }
                    is LoadState.Error -> item { ErrorPane(rowsState.message) { if (page == CollectionPage.Favorites) viewModel.loadFavoriteListings() else viewModel.loadDashboard() } }
                    is LoadState.Ready -> {
                        if (page == CollectionPage.Inbox) {
                            val inquiries = (dashboard as? LoadState.Ready)?.value?.inquiries.orEmpty()
                            if (inquiries.isEmpty()) item { EmptyPane("لا توجد استفسارات واردة على إعلاناتك حتى الآن") }
                            items(inquiries, key = { it.id }) { inquiry -> InquiryCard(inquiry, viewModel::showMessage) }
                        } else {
                            val rows = rowsState.value
                            if (rows.isEmpty()) item { Column(horizontalAlignment = Alignment.CenterHorizontally) { EmptyPane(if (page == CollectionPage.Favorites) "احفظ العقارات بعلامة القلب لتجدها هنا بسهولة" else "لم تضف إعلانات بعد"); TextButton(onBrowse) { Text("استكشف العقارات") } } }
                            items(rows, key = { it.id }) { p ->
                                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (page == CollectionPage.MyAds) Text(when (p.status) { "active" -> "منشور"; "pending" -> "قيد المراجعة"; "draft" -> "مسودة"; else -> "غير منشور" }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                                    PropertyCard(p, p.id in favorites, { if (page == CollectionPage.MyAds) viewModel.openOwnProperty(p) else viewModel.openProperty(p.id) }, { viewModel.toggleFavorite(p.id) }, compared.any { it.id == p.id }, { viewModel.toggleCompare(p) })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun InquiryCard(inquiry: Inquiry, onMessage: (String) -> Unit) {
    val context = LocalContext.current
    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text(inquiry.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); if (inquiry.status == "new") Badge { Text("جديد", Modifier.padding(4.dp)) } }
            Text(inquiry.propertyTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(12.dp)); Text(inquiry.message, style = MaterialTheme.typography.bodyMedium)
            if (inquiry.phone.isNotBlank()) TextButton({ runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${dialNumber(inquiry.phone)}"))) }.onFailure { onMessage("تعذر فتح تطبيق الاتصال") } }) { Icon(Icons.Default.Call, null); Spacer(Modifier.width(8.dp)); Text("اتصال بصاحب الاستفسار") }
        }
    }
}

@Composable private fun ComparisonContent(modifier: Modifier, rows: List<Property>, remove: (Property) -> Unit, onOpen: (String) -> Unit, onBrowse: () -> Unit) {
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 18.dp)) {
        Text("قارن حتى 3 عقارات جنبًا إلى جنب", Modifier.padding(horizontal = 18.dp), style = MaterialTheme.typography.titleMedium)
        Text("أضف العقارات بزر «قارن» من البطاقات أو صفحة التفاصيل. الأسعار معروضة بعملتها؛ لا تُقارن الأرقام بين عملات مختلفة.", Modifier.padding(horizontal = 18.dp, vertical = 6.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (rows.isEmpty()) { EmptyPane("لم تختر عقارات للمقارنة بعد"); Button(onBrowse, Modifier.align(Alignment.CenterHorizontally)) { Text("اختر عقارات") }; return@Column }
        Spacer(Modifier.height(18.dp))
        Column(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 18.dp)) {
            Row {
                Spacer(Modifier.width(82.dp))
                rows.forEach { p ->
                    Column(Modifier.width(180.dp).padding(horizontal = 6.dp)) {
                        Box {
                            PropertyCover(p, Modifier.fillMaxWidth().height(122.dp).clip(RoundedCornerShape(16.dp)).clickable { onOpen(p.id) })
                            FilledIconButton({ remove(p) }, Modifier.align(Alignment.TopEnd).padding(2.dp).size(40.dp)) { Icon(Icons.Default.Close, "إزالة ${p.title}", Modifier.size(19.dp)) }
                        }
                        Text(p.title, Modifier.padding(vertical = 10.dp).heightIn(min = 54.dp), maxLines = 2, style = MaterialTheme.typography.titleSmall)
                    }
                }
            }
            val metrics = listOf<Pair<String, (Property) -> String>>(
                "السعر" to { price(it) }, "العرض" to { it.mode }, "النوع" to { it.type },
                "الموقع" to { location(it) }, "المساحة" to { "${it.area?.toInt() ?: "—"} م²" },
                "الغرف" to { it.rooms?.toString() ?: "—" }, "الحمامات" to { it.baths?.toString() ?: "—" },
                "المعلن" to { it.owner?.name ?: if (it.sourceKind == "office") "مكتب عقاري" else "معلن عقاري" }
            )
            metrics.forEachIndexed { index, (label, value) ->
                Row(Modifier.background(if (index % 2 == 0) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.background).height(IntrinsicSize.Min), verticalAlignment = Alignment.CenterVertically) {
                    Text(label, Modifier.width(82.dp).padding(10.dp), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                    rows.forEach { p -> Text(value(p).ifBlank { "—" }, Modifier.width(180.dp).padding(12.dp), style = MaterialTheme.typography.bodyMedium) }
                }
            }
            Row { Spacer(Modifier.width(82.dp)); rows.forEach { p -> TextButton({ onOpen(p.id) }, Modifier.width(180.dp)) { Text("عرض التفاصيل") } } }
        }
    }
}

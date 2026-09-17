package com.aqartkom.nativeapp.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.aqartkom.nativeapp.R
import com.aqartkom.nativeapp.data.*
import com.aqartkom.nativeapp.ui.Gold
import com.aqartkom.nativeapp.ui.Navy
import com.aqartkom.nativeapp.ui.VideoThumbnail
import kotlinx.coroutines.launch
import java.text.NumberFormat
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    modifier: Modifier, state: LoadState<List<Property>>, favorites: Set<String>, comparison: Set<String>,
    darkMode: Boolean, onDarkMode: () -> Unit, onFavorites: () -> Unit,
    onOpen: (String) -> Unit, onFavorite: (String) -> Unit, onCompare: (Property) -> Unit,
    onRetry: () -> Unit, onSearch: (SearchFilters) -> Unit, onMap: () -> Unit, onHotels: () -> Unit
) {
    var page by rememberSaveable { mutableIntStateOf(0) }
    val rows = (state as? LoadState.Ready)?.value.orEmpty()
    val grid = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    val lastPage = ((rows.size - 1) / ListingsPerPage).coerceAtLeast(0)
    LaunchedEffect(rows.size) { page = page.coerceAtMost(lastPage) }
    Column(modifier.fillMaxSize()) {
        Surface(color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = RoundedCornerShape(14.dp), color = Navy) { Icon(Icons.Default.Apartment, null, Modifier.padding(10.dp).size(28.dp), tint = Gold) }
                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                    Text("عقارتكم", fontSize = 23.sp, fontWeight = FontWeight.Black)
                    Text("منصة العقارات السورية", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onDarkMode) { Icon(if (darkMode) Icons.Default.LightMode else Icons.Default.DarkMode, "تغيير المظهر") }
                IconButton(onFavorites) {
                    BadgedBox(badge = { if (favorites.isNotEmpty()) Badge(containerColor = Gold, contentColor = Navy) { Text(favorites.size.toString()) } }) { Icon(Icons.Default.FavoriteBorder, "العقارات المحفوظة") }
                }
            }
        }
        PullToRefreshBox(isRefreshing = state is LoadState.Loading, onRefresh = onRetry, modifier = Modifier.weight(1f)) {
            LazyVerticalGrid(columns = GridCells.Adaptive(320.dp), state = grid, contentPadding = PaddingValues(18.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                item(key = "hero", span = { GridItemSpan(maxLineSpan) }) { DiscoveryHero(onSearch) }
                item(key = "shortcuts", span = { GridItemSpan(maxLineSpan) }) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        QuickAction("ابحث على الخريطة", "استكشف الموقع", Icons.Default.Map, Modifier.weight(1f), onMap)
                        QuickAction("فنادق سوريا", "اختر الفندق وإقامتك", Icons.Default.Hotel, Modifier.weight(1f), onHotels)
                    }
                }
                item(key = "cities", span = { GridItemSpan(maxLineSpan) }) {
                    Column {
                        SectionHeading("أين تبحث؟", "اختر مدينتك")
                        Spacer(Modifier.height(10.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            rowItems(SyrianCities) { city -> SuggestionChip(onClick = { onSearch(SearchFilters(city = city)) }, label = { Text(city) }, icon = { Icon(Icons.Default.LocationOn, null, Modifier.size(16.dp), tint = Gold) }, shape = RoundedCornerShape(14.dp)) }
                        }
                    }
                }
                item(key = "listings-title", span = { GridItemSpan(maxLineSpan) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { SectionHeading("أحدث العقارات", "بيع وإيجار من الملاك والمكاتب") }
                        TextButton({ onSearch(SearchFilters()) }) { Text("بحث متقدم"); Icon(Icons.Default.ChevronLeft, null, Modifier.size(17.dp)) }
                    }
                }
                when (state) {
                    LoadState.Loading -> items(3) { PropertySkeleton() }
                    is LoadState.Error -> item(span = { GridItemSpan(maxLineSpan) }) { ErrorPane(state.message, onRetry) }
                    is LoadState.Ready -> {
                        if (rows.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { EmptyPane("لا توجد إعلانات متاحة حاليًا") }
                        items(listingPage(rows, page), key = { it.id }) { p -> PropertyCard(p, p.id in favorites, { onOpen(p.id) }, { onFavorite(p.id) }, p.id in comparison, { onCompare(p) }) }
                        if (rows.isNotEmpty()) item(key = "pagination", span = { GridItemSpan(maxLineSpan) }) {
                            Pagination(page, rows.size) { page = it; scope.launch { grid.scrollToItem(3) } }
                        }
                    }
                }
                item(key = "end", span = { GridItemSpan(maxLineSpan) }) {
                    Text("عقارتكم • مكان واحد لخطوتك العقارية القادمة", Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            }
        }
    }
}

@Composable private fun DiscoveryHero(onSearch: (SearchFilters) -> Unit) {
    var mode by rememberSaveable { mutableStateOf("بيع") }
    Surface(shape = RoundedCornerShape(26.dp), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column {
            // Use the same artwork as the website; keep it separate from the text.
            Image(painterResource(R.drawable.syria_panorama), "معالم سوريا وأبراج ومبانٍ سكنية — صورة واجهة فنية", Modifier.fillMaxWidth().aspectRatio(2f), contentScale = ContentScale.Fit)
            Column(Modifier.padding(18.dp)) {
                Text("مكانك القادم يبدأ هنا", style = MaterialTheme.typography.headlineSmall)
                Text("اكتشف العقارات في المدن والأحياء السورية", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("بيع" to "شراء عقار", "إيجار" to "استئجار").forEach { (value, label) ->
                        FilterChip(mode == value, { mode = value }, { Text(label) }, leadingIcon = { Icon(if (value == "بيع") Icons.Default.HomeWork else Icons.Default.Key, null, Modifier.size(17.dp)) }, shape = RoundedCornerShape(12.dp))
                    }
                }
                Spacer(Modifier.height(8.dp))
                Surface(onClick = { onSearch(SearchFilters(mode = mode)) }, shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.background, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Search, null, Modifier.padding(4.dp).size(23.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("مدينة، حي، أو نوع العقار", Modifier.weight(1f).padding(horizontal = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                        Surface(color = Navy, shape = RoundedCornerShape(11.dp)) { Icon(Icons.Default.ArrowBack, "بحث", Modifier.padding(12.dp), tint = Color.White) }
                    }
                }
            }
        }
    }
}

@Composable private fun QuickAction(title: String, subtitle: String, icon: ImageVector, modifier: Modifier, click: () -> Unit) {
    Surface(onClick = click, modifier = modifier, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer) {
        Column(Modifier.padding(15.dp)) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(27.dp))
            Spacer(Modifier.height(10.dp)); Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable fun SectionHeading(title: String, subtitle: String = "") {
    Text(title, style = MaterialTheme.typography.titleLarge)
    if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable fun PropertyCover(property: Property, modifier: Modifier = Modifier) {
    var failed by remember(property.imageUrl) { mutableStateOf(false) }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        val video = property.primaryVideo
        when {
            property.imageUrl.isNotBlank() && !failed -> AsyncImage(property.imageUrl, property.title, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, onError = { failed = true })
            video != null && video.sourceType == "upload" -> VideoThumbnail(video.url, Modifier.fillMaxSize())
            else -> Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.Apartment, null, Modifier.size(42.dp), tint = MaterialTheme.colorScheme.outline); Text(if (failed) "الصورة غير متاحة" else "لا تتوفر صورة", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable fun PropertyCard(property: Property, favorite: Boolean, onOpen: () -> Unit, onFavorite: () -> Unit, compared: Boolean = false, onCompare: (() -> Unit)? = null, compact: Boolean = false) {
    Surface(onClick = onOpen, shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        if (compact) {
            Column {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    PropertyCover(property, Modifier.size(width = 106.dp, height = 112.dp).clip(RoundedCornerShape(15.dp)))
                    Column(Modifier.weight(1f).padding(start = 12.dp)) {
                        Text(price(property), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(property.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(location(property), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    IconButton(onFavorite) { Icon(if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder, "حفظ العقار", tint = if (favorite) Color(0xFFD44E66) else MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                if (onCompare != null) TextButton(onCompare, Modifier.align(Alignment.End)) { Icon(Icons.Default.CompareArrows, null, Modifier.size(18.dp)); Text(if (compared) "إزالة من المقارنة" else "أضف للمقارنة", style = MaterialTheme.typography.labelMedium) }
            }
        } else Column {
            Box {
                PropertyCover(property, Modifier.fillMaxWidth().aspectRatio(1.65f))
                Row(Modifier.align(Alignment.TopStart).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    CardBadge(if (property.mode == "إيجار") "للإيجار" else "للبيع", Navy)
                    if (property.sponsored) CardBadge("ممول", Color(0xFF735610)) else if (property.featured) CardBadge("مميز", Color(0xFF735610))
                }
                FilledIconButton(onFavorite, Modifier.align(Alignment.TopEnd).padding(8.dp), colors = IconButtonDefaults.filledIconButtonColors(containerColor = Color.White.copy(.95f), contentColor = Navy)) { Icon(if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder, if (favorite) "إزالة من المفضلة" else "حفظ العقار", tint = if (favorite) Color(0xFFCC3F5B) else Navy) }
                if (property.primaryVideo != null) Surface(Modifier.align(Alignment.BottomEnd).padding(12.dp), color = Color.Black.copy(.65f), shape = RoundedCornerShape(9.dp)) { Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.PlayCircle, null, Modifier.size(17.dp), tint = Color.White); Spacer(Modifier.width(4.dp)); Text("فيديو", color = Color.White, style = MaterialTheme.typography.labelSmall) } }
            }
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(price(property), Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                    Text(property.type, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(5.dp)); Text(property.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(5.dp)); Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.LocationOn, null, Modifier.size(16.dp), tint = Gold); Text(location(property), Modifier.padding(start = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Spacer(Modifier.height(13.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) { Fact("${property.area?.toInt() ?: "—"} م²", Icons.Default.SquareFoot); Fact("${property.rooms ?: "—"} غرف", Icons.Default.Bed); Fact("${property.baths ?: "—"} حمام", Icons.Default.Bathtub) }
                HorizontalDivider(Modifier.padding(top = 14.dp), color = MaterialTheme.colorScheme.outlineVariant)
                Row(Modifier.fillMaxWidth().heightIn(min = 42.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (property.sourceKind == "office") Icons.Default.Storefront else Icons.Default.PersonOutline, null, Modifier.size(17.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(property.owner?.name ?: if (property.sourceKind == "office") "مكتب عقاري" else "إعلان عقاري", Modifier.weight(1f).padding(start = 5.dp), style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (onCompare != null) TextButton(onCompare, contentPadding = PaddingValues(horizontal = 5.dp)) { Icon(if (compared) Icons.Default.Check else Icons.Default.CompareArrows, null, Modifier.size(17.dp)); Spacer(Modifier.width(4.dp)); Text(if (compared) "للمقارنة" else "قارن", style = MaterialTheme.typography.labelMedium) }
                }
            }
        }
    }
}

@Composable private fun CardBadge(label: String, color: Color) { Surface(color = color, shape = RoundedCornerShape(8.dp)) { Text(label, Modifier.padding(horizontal = 10.dp, vertical = 5.dp), color = Color.White, style = MaterialTheme.typography.labelSmall) } }
@Composable private fun Fact(text: String, icon: ImageVector) { Row(verticalAlignment = Alignment.CenterVertically) { Icon(icon, null, Modifier.size(17.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant); Spacer(Modifier.width(5.dp)); Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
fun location(p: Property): String = listOf(p.city, p.district).filter(String::isNotBlank).joinToString("، ")
fun price(p: Property): String = if (p.price <= 0) "السعر لدى المعلن" else "${NumberFormat.getNumberInstance(Locale.US).format(p.price)} ${when (p.currency) { "USD" -> "دولار"; "SYP" -> "ل.س"; else -> p.currency }}"

@Composable fun Pagination(page: Int, count: Int, onPage: (Int) -> Unit) {
    val last = ((count - 1) / ListingsPerPage).coerceAtLeast(0)
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            OutlinedIconButton({ onPage(page - 1) }, enabled = page > 0) { Icon(Icons.Default.ChevronRight, "الصفحة السابقة") }
            Text("${page + 1} / ${last + 1}", style = MaterialTheme.typography.titleMedium)
            OutlinedIconButton({ onPage(page + 1) }, enabled = page < last) { Icon(Icons.Default.ChevronLeft, "الصفحة التالية") }
        }
        Text("${page * ListingsPerPage + 1}–${minOf((page + 1) * ListingsPerPage, count)} من $count إعلانًا محمّلًا", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable fun PropertySkeleton() {
    Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface) {
        Column { Box(Modifier.fillMaxWidth().aspectRatio(1.65f).background(MaterialTheme.colorScheme.surfaceVariant)); Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { repeat(3) { Box(Modifier.fillMaxWidth(if (it == 2) .5f else .85f).height(13.dp).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) } } }
    }
}
@Composable fun LoadingPane() { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
@Composable fun ErrorPane(message: String, retry: () -> Unit) { Column(Modifier.fillMaxWidth().padding(30.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.WifiOff, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.outline); Spacer(Modifier.height(12.dp)); Text(message, fontWeight = FontWeight.Bold); Spacer(Modifier.height(14.dp)); Button(retry) { Text("إعادة المحاولة") } } }
@Composable fun EmptyPane(message: String) { Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.HomeWork, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.outline); Spacer(Modifier.height(10.dp)); Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center) } }

package com.aqartkom.nativeapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import kotlinx.coroutines.launch
import com.aqartkom.nativeapp.data.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aqartkom.nativeapp.AppViewModel
import com.aqartkom.nativeapp.data.LoadState
import com.aqartkom.nativeapp.data.SearchFilters

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(modifier: Modifier, viewModel: AppViewModel, onOpen: (String) -> Unit, onMap: () -> Unit) {
    val initial by viewModel.filters.collectAsStateWithLifecycle()
    val state by viewModel.properties.collectAsStateWithLifecycle()
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val compared by viewModel.comparison.collectAsStateWithLifecycle()
    var filters by rememberSaveable(initial, stateSaver = FilterSaver) { mutableStateOf(initial) }
    val focus = LocalFocusManager.current
    var sheet by remember { mutableStateOf(false) }
    var compact by rememberSaveable { mutableStateOf(false) }
    var page by rememberSaveable(initial) { mutableIntStateOf(0) }
    val grid = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    val rows = (state as? LoadState.Ready)?.value.orEmpty()
    LaunchedEffect(rows.size) { page = page.coerceAtMost(((rows.size - 1) / ListingsPerPage).coerceAtLeast(0)) }
    fun search() { focus.clearFocus(); page = 0; viewModel.refresh(filters) }
    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { SectionHeading("اكتشف عقارك", "بحث أدق، خيارات أوضح") }
            FilledTonalIconButton(onMap) { Icon(Icons.Default.Map, "عرض النتائج على الخريطة") }
        }
        Row(Modifier.padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(value = filters.query, onValueChange = { filters = filters.copy(query = it) }, modifier = Modifier.weight(1f),
                placeholder = { Text("مدينة أو حي أو كلمة مفتاحية", style = MaterialTheme.typography.bodySmall) },
                leadingIcon = { IconButton({ search() }) { Icon(Icons.Default.Search, "تنفيذ البحث") } }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { search() }), shape = RoundedCornerShape(16.dp))
            Spacer(Modifier.width(8.dp)); FilledTonalIconButton({ sheet = true }, Modifier.size(54.dp)) { Icon(Icons.Default.Tune, "تصفية النتائج") }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("" to "كل العروض", "بيع" to "للبيع", "إيجار" to "للإيجار").forEach { (value, label) ->
                FilterChip(filters.mode == value, { filters = filters.copy(mode = value); search() }, { Text(label) })
            }
            if (initial.city.isNotBlank()) InputChip(true, { sheet = true }, { Text(initial.city) }, trailingIcon = { Icon(Icons.Default.LocationOn, null, Modifier.size(16.dp)) })
            if (initial.type.isNotBlank()) InputChip(true, { sheet = true }, { Text(initial.type) })
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (state is LoadState.Ready) "${rows.size} إعلانًا • الأحدث أولًا" else "جارٍ البحث…", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            IconToggleButton(compact, { compact = it }) { Icon(if (compact) Icons.Default.ViewAgenda else Icons.Default.ViewList, if (compact) "عرض بطاقات كبيرة" else "عرض قائمة مختصرة") }
        }
        LazyVerticalGrid(columns = GridCells.Adaptive(if (compact) 370.dp else 320.dp), state = grid, modifier = Modifier.weight(1f), contentPadding = PaddingValues(18.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            when (val result = state) {
                LoadState.Loading -> items(3) { PropertySkeleton() }
                is LoadState.Error -> item(span = { GridItemSpan(maxLineSpan) }) { ErrorPane(result.message) { search() } }
                is LoadState.Ready -> {
                    if (rows.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) { EmptyPane("لم نجد عقارًا بهذه المواصفات. جرّب توسيع المنطقة أو تعديل السعر."); TextButton({ filters = SearchFilters(); search() }) { Text("مسح الفلاتر") } }
                    }
                    items(listingPage(rows, page), key = { it.id }) { p -> PropertyCard(p, p.id in favorites, { onOpen(p.id) }, { viewModel.toggleFavorite(p.id) }, compared.any { it.id == p.id }, { viewModel.toggleCompare(p) }, compact) }
                    if (rows.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Pagination(page, rows.size) { page = it; scope.launch { grid.scrollToItem(0) } } }
                }
            }
        }
    }
    if (sheet) ModalBottomSheet(onDismissRequest = { sheet = false }) {
        FilterSheet(filters, { filters = it }, { sheet = false; search() })
    }
}

@Composable private fun FilterSheet(value: SearchFilters, onChange: (SearchFilters) -> Unit, apply: () -> Unit) {
    val cities = listOf("") + SyrianCities
    val types = listOf("", "شقة", "منزل", "فيلا", "أرض", "محل تجاري", "مكتب", "بناء", "مزرعة")
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text("تصفية النتائج", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge); TextButton({ onChange(SearchFilters()) }) { Text("مسح الكل") } }
        Text("نطاق السعر بالدولار الأمريكي", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ChoiceRow("المحافظة", cities, value.city) { onChange(value.copy(city = it)) }
        ChoiceRow("نوع العقار", types, value.type) { onChange(value.copy(type = it)) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(value.minPrice, { onChange(value.copy(minPrice = it)) }, Modifier.weight(1f), label = { Text("السعر من") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true)
            OutlinedTextField(value.maxPrice, { onChange(value.copy(maxPrice = it)) }, Modifier.weight(1f), label = { Text("السعر إلى") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true)
        }
        ChoiceRow("غرف النوم", listOf("", "1", "2", "3", "4", "5+"), value.rooms) { onChange(value.copy(rooms = it)) }
        Button(onClick = apply, Modifier.fillMaxWidth().height(52.dp)) { Text("عرض النتائج") }
        Spacer(Modifier.height(20.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ChoiceRow(label: String, choices: List<String>, selected: String, enabled: Boolean = true, onSelected: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(open, { if (enabled) open = !open }) {
        OutlinedTextField(selected.ifBlank { "الكل" }, {}, Modifier.menuAnchor().fillMaxWidth(), readOnly = true, enabled = enabled, label = { Text(label) }, trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) })
        ExposedDropdownMenu(open, { open = false }) { choices.forEach { DropdownMenuItem({ Text(it.ifBlank { "الكل" }) }, { onSelected(it); open = false }) } }
    }
}

private val FilterSaver = listSaver<SearchFilters, String>(
    save = { listOf(it.query, it.city, it.type, it.mode, it.minPrice, it.maxPrice, it.rooms) },
    restore = { SearchFilters(it[0], it[1], it[2], it[3], it[4], it[5], it[6]) }
)

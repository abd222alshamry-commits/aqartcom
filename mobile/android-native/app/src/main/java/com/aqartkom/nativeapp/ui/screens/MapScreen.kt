package com.aqartkom.nativeapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.aqartkom.nativeapp.data.LoadState
import com.aqartkom.nativeapp.data.Property
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style

private const val SATELLITE_STYLE = """{"version":8,"sources":{"satellite":{"type":"raster","tiles":["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],"tileSize":256,"attribution":"Esri"}},"layers":[{"id":"satellite","type":"raster","source":"satellite"}]}"""
private const val STREET_STYLE = """{"version":8,"sources":{"street":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],"tileSize":256,"maxzoom":19,"attribution":"© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"}},"layers":[{"id":"street","type":"raster","source":"street"}]}"""

@Composable
fun MapScreen(modifier: Modifier, state: LoadState<List<Property>>, onOpen: (String) -> Unit, onRetry: () -> Unit, focusId: String? = null) {
    val uriHandler = LocalUriHandler.current
    val rows = (state as? LoadState.Ready)?.value.orEmpty().filter { it.latitude != null && it.longitude != null }
    var satellite by rememberSaveable { mutableStateOf(true) }
    var selectedId by rememberSaveable(focusId) { mutableStateOf(focusId) }
    val selected = rows.firstOrNull { it.id == selectedId }
    val initial = rows.firstOrNull { it.id == focusId }
    var cameraLat by rememberSaveable(focusId) { mutableDoubleStateOf(initial?.latitude ?: 35.0) }
    var cameraLng by rememberSaveable(focusId) { mutableDoubleStateOf(initial?.longitude ?: 38.0) }
    var cameraZoom by rememberSaveable(focusId) { mutableDoubleStateOf(if (initial == null) 5.0 else 11.0) }
    Box(modifier.fillMaxSize()) {
        if (state is LoadState.Loading) LoadingPane() else if (state is LoadState.Error) ErrorPane(state.message, onRetry) else NativePropertyMap(rows, satellite, cameraLat, cameraLng, cameraZoom, { lat, lng, zoom ->
            cameraLat = lat; cameraLng = lng; cameraZoom = zoom
        }, { selectedId = it })
        Surface(Modifier.align(Alignment.TopCenter).padding(14.dp), shape = RoundedCornerShape(18.dp), tonalElevation = 8.dp) {
            Row(Modifier.padding(7.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Layers, null); Spacer(Modifier.width(6.dp)); Text("الخريطة"); Spacer(Modifier.width(10.dp))
                FilterChip(satellite, { satellite = true }, { Text("قمر صناعي") })
                Spacer(Modifier.width(6.dp)); FilterChip(!satellite, { satellite = false }, { Text("شوارع") })
            }
        }
        Surface(Modifier.align(Alignment.BottomCenter).padding(16.dp), shape = RoundedCornerShape(18.dp), tonalElevation = 8.dp) { Column(Modifier.padding(12.dp)) {
            Text("${rows.size} علامة • المواقع تقريبية", style = MaterialTheme.typography.labelMedium)
            Text(if (satellite) "الصور © Esri ومساهموها" else "© OpenStreetMap contributors", Modifier.clickable { runCatching { uriHandler.openUri(if (satellite) "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" else "https://www.openstreetmap.org/copyright") } }.padding(vertical = 4.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (selected != null) Row(Modifier.fillMaxWidth().clickable { onOpen(selected.id) }.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                PropertyCover(selected, Modifier.size(70.dp).clip(RoundedCornerShape(12.dp)))
                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) { Text(price(selected), style = MaterialTheme.typography.titleMedium); Text(selected.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall); Text("عرض التفاصيل", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
                Icon(Icons.Default.ChevronLeft, null)
            } else Text("اضغط على العلامة لمعاينة الإعلان", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } }
    }
}

@Composable private fun NativePropertyMap(
    properties: List<Property>, satellite: Boolean,
    latitude: Double, longitude: Double, zoom: Double,
    onCameraChanged: (Double, Double, Double) -> Unit, onOpen: (String) -> Unit
) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val context = LocalContext.current
    val mapView = remember { MapView(context).apply { onCreate(null) } }
    val currentOnOpen by rememberUpdatedState(onOpen)
    val currentCameraChanged by rememberUpdatedState(onCameraChanged)
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var styleReady by remember { mutableIntStateOf(0) }
    DisposableEffect(lifecycle, mapView) {
        var attached = true
        mapView.getMapAsync { value ->
            if (attached) {
                value.uiSettings.setAttributionMargins(12, 0, 12, (172 * context.resources.displayMetrics.density).toInt())
                value.cameraPosition = CameraPosition.Builder().target(LatLng(latitude, longitude)).zoom(zoom).build()
                value.addOnCameraIdleListener {
                    if (attached) value.cameraPosition.let { position -> position.target?.let { currentCameraChanged(it.latitude, it.longitude, position.zoom) } }
                }
                map = value
            }
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            attached = false
            lifecycle.removeObserver(observer)
            mapView.onPause(); mapView.onStop(); mapView.onDestroy()
        }
    }
    AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())
    DisposableEffect(map, satellite) {
        var attached = true
        styleReady = 0
        map?.setStyle(if (satellite) Style.Builder().fromJson(SATELLITE_STYLE) else Style.Builder().fromJson(STREET_STYLE)) {
            if (attached) styleReady = 1
        }
        onDispose { attached = false }
    }
    LaunchedEffect(map, styleReady, properties) {
        val value = map ?: return@LaunchedEffect
        if (styleReady == 0) return@LaunchedEffect
        value.clear()
        val links = properties.associate { p ->
            val marker = value.addMarker(MarkerOptions().position(LatLng(p.latitude!!, p.longitude!!)).title(p.title).snippet("${p.city} • ${price(p)}"))
            marker.id to p.id
        }
        value.setOnMarkerClickListener { marker -> links[marker.id]?.let(currentOnOpen); true }
    }
}

package com.aqartkom.nativeapp.ui.screens

import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import com.aqartkom.nativeapp.data.LoadState
import com.aqartkom.nativeapp.data.Property
import com.aqartkom.nativeapp.data.PropertyVideo
import com.aqartkom.nativeapp.data.propertyLink
import com.aqartkom.nativeapp.data.phoneDigits
import com.aqartkom.nativeapp.data.dialNumber
import androidx.compose.ui.res.painterResource
import com.aqartkom.nativeapp.R
import androidx.compose.ui.text.style.TextOverflow
import com.aqartkom.nativeapp.ui.Gold
import com.aqartkom.nativeapp.ui.VideoThumbnail

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PropertyDetailScreen(
    state: LoadState<Property>, favorite: Boolean, onBack: () -> Unit, onFavorite: () -> Unit,
    onRetry: () -> Unit, onMessage: (String) -> Unit,
    onMap: (Property) -> Unit, onCompare: (Property) -> Unit, compared: Boolean,
    snackbarHost: @Composable () -> Unit = {}
) {
    val context = LocalContext.current
    Scaffold(snackbarHost = snackbarHost, bottomBar = { (state as? LoadState.Ready)?.value?.let { ContactBar(it, onMessage) } }, topBar = {
        TopAppBar(title = { Text("تفاصيل العقار") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowForward, "رجوع") } }, actions = { IconButton(onClick = onFavorite) { Icon(if (favorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, "المفضلة", tint = if (favorite) Color(0xFFD33A4A) else LocalContentColor.current) }; IconButton(onClick = { (state as? LoadState.Ready)?.value?.let { p -> context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "${p.title}\n${propertyLink(p)}"), "مشاركة العقار")) } }) { Icon(Icons.Default.Share, "مشاركة") } })
    }) { padding ->
        when (state) {
            LoadState.Loading -> Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            is LoadState.Error -> Box(Modifier.padding(padding)) { ErrorPane(state.message, onRetry) }
            is LoadState.Ready -> DetailContent(Modifier.padding(padding), state.value, onMessage, onMap, onCompare, compared)
        }
    }
}

@Composable private fun DetailContent(modifier: Modifier, p: Property, onMessage: (String) -> Unit, onMap: (Property) -> Unit, onCompare: (Property) -> Unit, compared: Boolean) {
    val context = LocalContext.current
    var video by remember(p.id) { mutableStateOf<PropertyVideo?>(null) }
    var openImage by remember(p.id) { mutableStateOf<Int?>(null) }
    var expandedDescription by rememberSaveable(p.id) { mutableStateOf(false) }
    val images = (p.images.map { it.url } + p.imageUrl).filter { it.isNotBlank() }.distinct()
    val pager = rememberPagerState { images.size.coerceAtLeast(1) }
    androidx.compose.foundation.lazy.LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Box {
                if (images.isNotEmpty()) HorizontalPager(pager, Modifier.fillMaxWidth().height(300.dp)) { index -> GalleryImage(images[index], p.title, Modifier.fillMaxSize().clickable { video = null; openImage = index }, ContentScale.Crop) }
                else {
                    val mainVideo = p.primaryVideo
                    Box(Modifier.fillMaxWidth().height(240.dp).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                        if (mainVideo != null && mainVideo.sourceType == "upload") {
                            VideoThumbnail(mainVideo.url, Modifier.fillMaxSize().clickable { openImage = null; video = mainVideo })
                            IconButton(onClick = { video = mainVideo }, modifier = Modifier.size(64.dp)) { Icon(Icons.Default.PlayCircle, "تشغيل الفيديو", Modifier.fillMaxSize(), tint = Color.White) }
                        } else Text("لا تتوفر صور لهذا الإعلان")
                    }
                }
                if (images.isNotEmpty()) Surface(Modifier.align(Alignment.BottomCenter).padding(12.dp), color = Color.Black.copy(.62f), shape = RoundedCornerShape(50)) { Text("${pager.currentPage + 1} / ${images.size}", Modifier.padding(horizontal = 12.dp, vertical = 5.dp), color = Color.White) }
            }
        }
        item {
            Column(Modifier.padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(50)) { Text(p.mode, Modifier.padding(horizontal = 12.dp, vertical = 6.dp), fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.weight(1f)); Text(price(p), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black, color = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.height(12.dp)); Text(p.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(7.dp)); Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.LocationOn, null, tint = Gold); Text("${p.city}${p.district.takeIf { it.isNotBlank() }?.let { "، $it" }.orEmpty()}", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Spacer(Modifier.height(18.dp)); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { DetailFact("المساحة", "${p.area?.toInt() ?: "—"} م²", Icons.Default.SquareFoot, Modifier.weight(1f)); DetailFact("الغرف", "${p.rooms ?: "—"}", Icons.Default.Bed, Modifier.weight(1f)); DetailFact("الحمامات", "${p.baths ?: "—"}", Icons.Default.Bathtub, Modifier.weight(1f)) }
            }
        }
        if (p.videos.isNotEmpty() || p.primaryVideo != null) item {
            Column(Modifier.padding(horizontal = 18.dp)) {
                Text("فيديو العقار", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                (p.videos.ifEmpty { listOfNotNull(p.primaryVideo) }).forEach { v ->
                    ElevatedCard(onClick = { openImage = null; video = v }, Modifier.fillMaxWidth().height(112.dp), shape = RoundedCornerShape(18.dp)) {
                        Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.width(134.dp).fillMaxHeight().background(Color.Black), contentAlignment = Alignment.Center) {
                                if (v.posterUrl.isNotBlank()) AsyncImage(v.posterUrl, "صورة حقيقية من الفيديو", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                else if (v.sourceType == "upload") VideoThumbnail(v.url, Modifier.fillMaxSize())
                                Icon(Icons.Default.PlayCircle, "تشغيل", Modifier.size(46.dp), tint = Color.White)
                            }
                            Spacer(Modifier.width(12.dp)); Column(Modifier.weight(1f).padding(end = 12.dp)) { Text(v.title, fontWeight = FontWeight.Bold, maxLines = 2); Text("اضغط للتشغيل بملء الشاشة", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                    Spacer(Modifier.height(9.dp))
                }
            }
        }
        item {
            Column(Modifier.padding(18.dp)) {
                Text("الوصف", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Spacer(Modifier.height(8.dp)); Text(p.description.ifBlank { "لم يضف المعلن وصفًا لهذا العقار." }, style = MaterialTheme.typography.bodyLarge, maxLines = if (expandedDescription) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis)
                if (p.description.length > 200) TextButton({ expandedDescription = !expandedDescription }) { Text(if (expandedDescription) "عرض أقل" else "قراءة الوصف كاملًا") }
                Spacer(Modifier.height(14.dp))
                OutlinedButton({ onCompare(p) }, Modifier.fillMaxWidth().heightIn(min = 50.dp)) { Icon(if (compared) Icons.Default.Check else Icons.Default.CompareArrows, null); Spacer(Modifier.width(8.dp)); Text(if (compared) "أُضيف للمقارنة • اضغط للإزالة" else "أضف إلى مقارنة العقارات") }
                if (p.latitude != null && p.longitude != null) {
                    Spacer(Modifier.height(18.dp))
                    Surface(onClick = { onMap(p) }, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer) { Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Map, null, Modifier.size(36.dp)); Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text("موقع العقار", style = MaterialTheme.typography.titleMedium); Text("عرض العلامة التقريبية على الخريطة", style = MaterialTheme.typography.bodySmall) }; Icon(Icons.Default.ChevronLeft, null) } }
                }
                Spacer(Modifier.height(22.dp)); Text("المعلن", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Spacer(Modifier.height(10.dp))
                ElevatedCard(shape = RoundedCornerShape(20.dp)) { Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.primary) { Text((p.owner?.name ?: "ع").take(1), Modifier.padding(15.dp), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Black) }; Spacer(Modifier.width(12.dp)); Column(Modifier.weight(1f)) { Text(p.owner?.name ?: "معلن عقاري", fontWeight = FontWeight.Bold); Text(if (p.owner?.role == "agent") "مكتب عقاري" else "معلن العقار", color = MaterialTheme.colorScheme.onSurfaceVariant) } } }
                Spacer(Modifier.height(18.dp))
                Text("تواصل مباشرة مع المعلن للاستفسار عن التفاصيل والتوفر.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

            }
        }
    }
    openImage?.let { FullscreenImages(images, it) { openImage = null } }
    video?.let { FullscreenVideo(it) { video = null } }
}

@Composable private fun ContactBar(p: Property, onMessage: (String) -> Unit) {
    val context = LocalContext.current
    val phone = p.owner?.phone.orEmpty()
    fun open(intent: Intent) { runCatching { context.startActivity(intent) }.onFailure { onMessage("لا يوجد تطبيق مناسب لفتح الرابط على هذا الجهاز") } }
    Surface(shadowElevation = 12.dp, color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = 18.dp, vertical = 10.dp)) {
            if (phone.isBlank()) Text("لم يضع المعلن رقم تواصل", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button({ open(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${dialNumber(phone)}"))) }, Modifier.weight(1f).height(52.dp), enabled = phone.isNotBlank(), shape = RoundedCornerShape(15.dp)) { Icon(Icons.Default.Call, null); Spacer(Modifier.width(7.dp)); Text("اتصال بالمعلن") }
                Button({ open(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/${phoneDigits(phone)}?text=${Uri.encode("مرحبًا، أستفسر عن ${p.title}\n${propertyLink(p)}")}"))) }, Modifier.weight(1f).height(52.dp), enabled = phone.isNotBlank(), shape = RoundedCornerShape(15.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF177B51), contentColor = Color.White)) { Icon(painterResource(R.drawable.ic_whatsapp), null, Modifier.size(21.dp)); Spacer(Modifier.width(7.dp)); Text("واتساب") }
            }
        }
    }
}

@Composable private fun FullscreenImages(images: List<String>, start: Int, close: () -> Unit) {
    Dialog(onDismissRequest = close, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val pager = rememberPagerState(initialPage = start) { images.size }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize()) { index ->
                GalleryImage(images[index], "صورة العقار ${index + 1}", Modifier.fillMaxSize(), ContentScale.Fit)
            }
            Surface(Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(18.dp), color = Color.Black.copy(.65f), shape = RoundedCornerShape(50)) { Text("${pager.currentPage + 1} / ${images.size}", Modifier.padding(horizontal = 14.dp, vertical = 7.dp), color = Color.White) }
            IconButton(close, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp).background(Color.Black.copy(.6f), RoundedCornerShape(50))) { Icon(Icons.Default.Close, "إغلاق الصور", tint = Color.White) }
        }
    }
}

@Composable private fun GalleryImage(url: String, description: String, modifier: Modifier, scale: ContentScale) {
    var attempt by remember(url) { mutableIntStateOf(0) }
    key(url, attempt) {
    SubcomposeAsyncImage(model = url, contentDescription = description, modifier = modifier, contentScale = scale,
        loading = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(28.dp)) } },
        error = {
            Column(Modifier.fillMaxSize().background(Color(0xFF132535)).padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text("تعذر تحميل الصورة", color = Color.White)
                TextButton(onClick = { attempt++ }) { Text("إعادة المحاولة", color = Color.White) }
            }
        })
    }
}

@Composable private fun DetailFact(label: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier) { Surface(modifier, color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(18.dp)) { Column(Modifier.padding(vertical = 13.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(icon, null, tint = MaterialTheme.colorScheme.primary); Text(value, fontWeight = FontWeight.Bold); Text(label, style = MaterialTheme.typography.labelSmall) } } }

@Composable private fun FullscreenVideo(video: PropertyVideo, close: () -> Unit) {
    Dialog(onDismissRequest = close, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            if (video.sourceType == "upload" || video.url.substringBefore('?').endsWith(".mp4", true)) DirectVideo(video.url) else SocialVideo(video.url)
            IconButton(close, Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp).background(Color.Black.copy(.6f), RoundedCornerShape(50))) { Icon(Icons.Default.Close, "إغلاق", tint = Color.White) }
        }
    }
}

@Composable private fun DirectVideo(url: String) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var player by remember(url) { mutableStateOf<ExoPlayer?>(null) }
    var position by rememberSaveable(url) { mutableLongStateOf(0L) }
    var firstStart by rememberSaveable(url) { mutableStateOf(true) }
    var error by remember(url) { mutableStateOf<String?>(null) }
    DisposableEffect(url, lifecycle) {
        fun start() {
            if (player != null) return
            player = ExoPlayer.Builder(context).build().apply {
                setAudioAttributes(AudioAttributes.Builder().setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).setUsage(C.USAGE_MEDIA).build(), true)
                setHandleAudioBecomingNoisy(true)
                addListener(object : Player.Listener {
                    override fun onPlayerError(exception: PlaybackException) { error = "تعذر تشغيل الفيديو. تحقق من الاتصال وأعد المحاولة." }
                })
                setMediaItem(MediaItem.fromUri(url))
                seekTo(position)
                prepare()
                playWhenReady = firstStart
                firstStart = false
            }
        }
        fun stop() { player?.let { position = it.currentPosition; it.release() }; player = null }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> start()
                Lifecycle.Event.ON_PAUSE -> player?.pause()
                Lifecycle.Event.ON_STOP -> stop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); stop() }
    }
    Box(Modifier.fillMaxSize()) {
        AndroidView(factory = { PlayerView(it).apply { useController = true } }, update = { it.player = player }, onRelease = { it.player = null }, modifier = Modifier.fillMaxSize())
        error?.let { message ->
            Column(Modifier.align(Alignment.Center).background(Color.Black.copy(.85f)).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(message, color = Color.White)
                Button(onClick = { error = null; player?.prepare(); player?.play() }) { Text("إعادة المحاولة") }
            }
        }
    }
}

@Suppress("SetJavaScriptEnabled")
@Composable private fun SocialVideo(url: String) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val webView = remember(url) {
        WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(-1, -1)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.scheme !in setOf("https", "http")
            }
            loadUrl(url)
        }
    }
    DisposableEffect(webView, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> webView.onResume()
                Lifecycle.Event.ON_PAUSE -> webView.onPause()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            webView.stopLoading()
            webView.onPause()
            webView.loadUrl("about:blank")
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.removeAllViews()
            webView.destroy()
        }
    }
    AndroidView(factory = { webView }, modifier = Modifier.fillMaxSize())
}

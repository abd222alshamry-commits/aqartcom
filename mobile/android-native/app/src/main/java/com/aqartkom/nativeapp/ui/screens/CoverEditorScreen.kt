package com.aqartkom.nativeapp.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.aqartkom.nativeapp.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.Locale

/** Selection is staged locally; only the fixed Save button writes to the server. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CoverEditorScreen(
    load: suspend () -> CoverState,
    save: suspend (CoverChoice, String) -> CoverSaved,
    onSaved: (CoverSaved) -> Unit,
    onBack: () -> Unit
) {
    var state by remember { mutableStateOf<CoverState?>(null) }
    var choice by remember { mutableStateOf<CoverChoice?>(null) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var stale by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    var openVideo by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(retry) {
        loading = true; error = null; stale = false; choice = null
        try { state = load(); choice = if (state?.automatic == true) CoverChoice("auto") else null }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { state = null; error = e.message ?: "تعذر تحميل وسائط العرض" }
        finally { loading = false }
    }
    fun select(next: CoverChoice) { if (!saving && !stale) { choice = next; error = null } }
    BackHandler { if (!saving) onBack() }
    Scaffold(topBar = {
        TopAppBar(title = { Text("صورة العرض الرئيسية") }, navigationIcon = {
            IconButton({ onBack() }, enabled = !saving) { Icon(Icons.Default.ArrowForward, "رجوع") }
        })
    }, bottomBar = {
        Surface(shadowElevation = 8.dp) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("cover-error")) }
                if (stale) TextButton({ retry++ }, enabled = !saving) { Text("تحديث الوسائط وإعادة الاختيار") }
                else choice?.let {
                    Text(when {
                        it.type == "auto" -> "الغلاف التلقائي: لقطة الفيديو، أو أول صورة متاحة."
                        it.seconds != null -> "لقطة عند ${String.format(Locale.US, "%.2f", it.seconds)} ثانية • اضغط حفظ وتطبيق"
                        else -> "تم الاختيار • اضغط حفظ وتطبيق"
                    }, style = MaterialTheme.typography.bodySmall)
                }
                Button(onClick = {
                    val pending = choice
                    val revision = state?.revision
                    if (pending != null && revision != null && !saving && !stale) {
                        saving = true; error = null
                        scope.launch {
                            try { onSaved(save(pending, revision)) }
                            catch (e: CancellationException) { throw e }
                            catch (e: Exception) {
                                error = e.message ?: "تعذر حفظ الغلاف؛ أعد المحاولة"
                                stale = e is ApiException && e.status == 409
                            } finally { saving = false }
                        }
                    }
                }, enabled = !loading && !saving && !stale && choice != null && state != null,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("cover-save")) {
                    if (saving) { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
                    Text(if (saving) "جارٍ الحفظ…" else "حفظ وتطبيق")
                }
            }
        }
    }) { padding ->
        if (loading) Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else if (state == null) Box(Modifier.padding(padding)) { ErrorPane(error ?: "تعذر التحميل", { retry++ }) }
        else {
            val data = state!!
            val enabled = !saving && !stale
            LazyColumn(Modifier.padding(padding).fillMaxSize().testTag("cover-media"), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                item {
                    Text("اختر صورة من العرض أو لقطة من الفيديو ثم اضغط «حفظ وتطبيق». يمكنك الرجوع وترك الغلاف التلقائي دون اختيار.")
                    if (data.currentUrl.isNotBlank()) {
                        Text("الغلاف المحفوظ حاليًا", Modifier.padding(top = 12.dp), fontWeight = FontWeight.Bold)
                        AsyncImage(data.currentUrl, "الغلاف الحالي", Modifier.fillMaxWidth().height(150.dp), contentScale = ContentScale.Fit)
                    }
                    OutlinedButton({ openVideo = null; select(CoverChoice("auto")) }, enabled = enabled, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) {
                        Icon(if (choice?.type == "auto") Icons.Default.CheckCircle else Icons.Default.AutoAwesome, null)
                        Spacer(Modifier.width(8.dp)); Text("استخدام الغلاف التلقائي")
                    }
                }
                if (data.media.isEmpty()) item { Text("لا توجد مرفقات. أضف صورة أو فيديو إلى العرض أولًا.") }
                itemsIndexed(data.media, key = { _, item -> item.type + item.url }) { index, item ->
                    val selected = choice?.url == item.url && choice?.type == item.type
                    OutlinedCard(border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(item.title.ifBlank { if (item.type == "video") "فيديو العرض" else "صورة العرض ${index + 1}" }, fontWeight = FontWeight.Bold)
                            if (item.type == "image") {
                                AsyncImage(item.displayUrl, "صورة من العرض", Modifier.fillMaxWidth().height(185.dp), contentScale = ContentScale.Fit)
                                OutlinedButton({ openVideo = null; select(CoverChoice("image", item.url)) }, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag("cover-image-$index")) {
                                    Text(if (selected) "تم اختيار هذه الصورة" else "تعيين هذه الصورة")
                                }
                            } else {
                                if (openVideo == item.url && item.canExtract) {
                                    key(item.url) { FramePicker(item.displayUrl, enabled) { seconds -> select(CoverChoice("video", item.url, seconds)) } }
                                } else {
                                    if (item.poster.isNotBlank()) AsyncImage(item.poster, "لقطة من الفيديو", Modifier.fillMaxWidth().height(185.dp), contentScale = ContentScale.Fit)
                                    if (item.canExtract) OutlinedButton({ openVideo = item.url }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                                        Icon(Icons.Default.PlayCircle, null); Spacer(Modifier.width(8.dp)); Text("اختيار لقطة من هذا الفيديو")
                                    }
                                }
                                if (item.poster.isNotBlank()) OutlinedButton({ select(CoverChoice("video", item.url)) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Text("استخدام صورة الفيديو الحالية") }
                                if (!item.canExtract && item.poster.isBlank()) Text("لا تتوفر لقطة لهذا الرابط. اختر صورة مرفوعة إلى العرض.")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FramePicker(url: String, enabled: Boolean, choose: (Double) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val player = remember(url) { ExoPlayer.Builder(context).build().apply { setMediaItem(MediaItem.fromUri(url)); prepare(); playWhenReady = false } }
    var ready by remember(url) { mutableStateOf(false) }
    var error by remember(url) { mutableStateOf<String?>(null) }
    DisposableEffect(player, lifecycle) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) { ready = playbackState == Player.STATE_READY || playbackState == Player.STATE_ENDED }
            override fun onPlayerError(failure: PlaybackException) { ready = false; error = "تعذر تشغيل الفيديو. أعد المحاولة أو اختر صورة مرفوعة." }
        }
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) player.pause() }
        player.addListener(listener); lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); player.removeListener(listener); player.release() }
    }
    LaunchedEffect(enabled) { if (!enabled) player.pause() }
    AndroidView(factory = { PlayerView(it).apply { this.player = player; useController = true; controllerShowTimeoutMs = 0 } }, modifier = Modifier.fillMaxWidth().height(220.dp).background(Color.Black))
    Text("حرّك شريط الفيديو إلى اللقطة المطلوبة، ثم اعتمدها واحفظها.", style = MaterialTheme.typography.bodySmall)
    error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton({ error = null; player.prepare() }, enabled = enabled) { Text("إعادة تشغيل الفيديو") } }
    OutlinedButton(onClick = {
        player.pause()
        // Do not ask the server for a frame beyond the last decodable moment.
        val end = (player.duration - 50L).coerceAtLeast(0L)
        choose(player.currentPosition.coerceIn(0L, end).toDouble() / 1000.0)
    }, enabled = enabled && ready && player.duration > 0, modifier = Modifier.fillMaxWidth()) { Text("اعتماد هذه اللقطة") }
}

package com.aqartkom.nativeapp.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.security.MessageDigest

/** One decoder at a time, small frames, and a bounded cache shared by cards and details. */
private object VideoFrames {
    private val decoderLock = Mutex()
    private val memory = object : LruCache<String, Bitmap>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val failed = object : LruCache<String, Long>(40) {}

    suspend fun load(context: Context, source: String): Bitmap? = withContext(Dispatchers.IO) {
        memory.get(source)?.let { return@withContext it }
        decoderLock.withLock {
            memory.get(source)?.let { return@withLock it }
            if (System.currentTimeMillis() - (failed.get(source) ?: 0L) < 60_000) return@withLock null
            val directory = File(context.cacheDir, "video-frames").apply { mkdirs() }
            val key = MessageDigest.getInstance("SHA-256").digest(source.toByteArray()).joinToString("") { "%02x".format(it) }
            val cached = File(directory, "$key.jpg")
            if (cached.isFile) BitmapFactory.decodeFile(cached.path)?.let { memory.put(source, it); return@withLock it }
            val frame = try {
                val retriever = MediaMetadataRetriever()
                try {
                    if (source.startsWith("https://")) retriever.setDataSource(source, mapOf("User-Agent" to "Aqartkom-Android"))
                    else retriever.setDataSource(context, Uri.parse(source))
                    val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 2000L
                    val time = minOf(1_000_000L, duration * 500L)
                    if (Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 640, 480)
                    else retriever.getFrameAtTime(time, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { full ->
                        val ratio = minOf(1f, 640f / full.width, 480f / full.height)
                        Bitmap.createScaledBitmap(full, (full.width * ratio).toInt().coerceAtLeast(1), (full.height * ratio).toInt().coerceAtLeast(1), true).also { if (it !== full) full.recycle() }
                    }
                } finally { retriever.release() }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { null }
            if (frame != null) {
                memory.put(source, frame)
                runCatching {
                    cached.outputStream().use { frame.compress(Bitmap.CompressFormat.JPEG, 82, it) }
                    var bytes = directory.listFiles().orEmpty().sumOf { it.length() }
                    directory.listFiles().orEmpty().sortedBy { it.lastModified() }.forEach { file ->
                        if (bytes > 20L * 1024 * 1024 && file != cached) { val size = file.length(); if (file.delete()) bytes -= size }
                    }
                }
            } else failed.put(source, System.currentTimeMillis())
            frame
        }
    }
}

@Composable
fun VideoThumbnail(url: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current.applicationContext
    var bitmap by remember(url) { mutableStateOf<Bitmap?>(null) }
    var finished by remember(url) { mutableStateOf(false) }
    LaunchedEffect(url) { bitmap = VideoFrames.load(context, url); finished = true }
    Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        when {
            bitmap != null -> Image(bitmap!!.asImageBitmap(), "لقطة من الفيديو", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            !finished -> CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp, color = Color.White)
            else -> Icon(Icons.Default.Videocam, "لا تتوفر معاينة", Modifier.size(36.dp), tint = Color.LightGray)
        }
    }
}

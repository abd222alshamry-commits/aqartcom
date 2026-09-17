package com.aqartkom.nativeapp.data

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import com.aqartkom.nativeapp.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class AqartkomApi(context: Context) {
    private val appContext = context.applicationContext
    private val origin = BuildConfig.API_ORIGIN.trimEnd('/')
    private val parser = PropertyParser(origin)
    private val preferences = context.getSharedPreferences("aqartkom_native", Context.MODE_PRIVATE)
    private val cookies = PersistentCookieJar(context, origin.toHttpUrl())
    private val client = OkHttpClient.Builder()
        .cookieJar(cookies)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(3, TimeUnit.MINUTES)
        .writeTimeout(5, TimeUnit.MINUTES)
        .build()

    suspend fun properties(filters: SearchFilters = SearchFilters()): List<Property> = withContext(Dispatchers.IO) {
        val url = "$origin/api/properties".toHttpUrl().newBuilder()
            .addQueryParameter("limit", "100")
            .addQueryParameter("placement", if (filters.query.isBlank()) "homepage" else "search")
            .addQueryParameter("includeOffices", "true")
            .apply {
                if (filters.query.isNotBlank()) addQueryParameter("q", filters.query)
                if (filters.city.isNotBlank()) addQueryParameter("city", filters.city)
                if (filters.type.isNotBlank()) addQueryParameter("type", filters.type)
                if (filters.mode.isNotBlank()) addQueryParameter("mode", filters.mode)
                if (filters.minPrice.isNotBlank()) addQueryParameter("minPrice", filters.minPrice)
                if (filters.maxPrice.isNotBlank()) addQueryParameter("maxPrice", filters.maxPrice)
                if (filters.rooms.isNotBlank()) addQueryParameter("rooms", filters.rooms)
            }.build()
        val json = try {
            executeJson(Request.Builder().url(url).get().build()).also { preferences.edit().putString("properties_" + url.toString().hashCode(), it.toString()).apply() }
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            preferences.getString("properties_" + url.toString().hashCode(), null)?.let(::JSONObject) ?: throw error
        }
        newestListings(json.getJSONArray("data").objects().map { parser.parse(it) })
    }

    private val hotelParser = HotelParser(origin)

    suspend fun hotels(search: HotelSearch): List<Hotel> = withContext(Dispatchers.IO) {
        require(search.error() == null) { search.error().orEmpty() }
        val url = "$origin/api/hotels".toHttpUrl().newBuilder()
            .addQueryParameter("q", search.query).addQueryParameter("city", search.city)
            .addQueryParameter("checkIn", search.checkIn).addQueryParameter("checkOut", search.checkOut)
            .addQueryParameter("adults", search.adults.toString()).addQueryParameter("rooms", search.rooms.toString()).build()
        executeJson(Request.Builder().url(url).get().build()).getJSONArray("data").objects().map(hotelParser::hotel)
    }
    suspend fun hotel(id: String): HotelDetail = withContext(Dispatchers.IO) {
        hotelParser.detail(executeJson(Request.Builder().url("$origin/api/hotels/$id").get().build()))
    }
    suspend fun hotelQuote(search: HotelSearch, hotel: String, room: String): HotelQuote = withContext(Dispatchers.IO) {
        val fields = search.quoteFields(hotel, room)
        val url = "$origin/api/mobile/hotels/quote".toHttpUrl().newBuilder().apply { fields.keys().forEach { addQueryParameter(it, fields.get(it).toString()) } }.build()
        try { hotelParser.quote(executeJson(Request.Builder().url(url).get().build())) }
        catch (e: ApiException) { if (e.status == 404) throw ApiException("خدمة التحقق من الحجز غير متاحة حاليًا. يمكنك متابعة استعراض الفنادق.", 404) else throw e }
    }
    suspend fun bookHotel(body: String): HotelReceipt = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$origin/api/mobile/hotels/book").post(body.toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())).build()
        client.newBuilder().retryOnConnectionFailure(false).followRedirects(false).build().newCall(request).execute().use { response ->
            val json = runCatching { JSONObject(response.body?.string().orEmpty()) }.getOrElse { JSONObject() }
            if (!response.isSuccessful) throw ApiException(json.optString("error", "تعذر إرسال الحجز"), response.code)
            hotelParser.receipt(json)
        }
    }

    suspend fun ownerDashboard(): OwnerDashboard = withContext(Dispatchers.IO) {
        val json = executeJson(Request.Builder().url("$origin/api/me/dashboard").get().build())
        OwnerDashboard(
            json.getJSONArray("properties").objects().map { parser.parse(it) },
            json.getJSONArray("inquiries").objects().map { Inquiry(it.optString("id"), it.optString("title"), it.optString("sender_name"), if (it.isNull("sender_phone")) "" else it.optString("sender_phone"), it.optString("message"), it.optString("status")) }
        )
    }

    suspend fun property(id: String): Property = withContext(Dispatchers.IO) {
        val market = id.startsWith("market-")
        val path = if (market) "/api/market/listings/${id.removePrefix("market-")}" else "/api/properties/$id"
        val response = executeJson(Request.Builder().url(origin + path).get().build())
        parser.parse(response, market)
    }

    suspend fun me(): User? = withContext(Dispatchers.IO) {
        val value = executeJson(Request.Builder().url("$origin/api/auth/me").get().build()).optJSONObject("user")
        value?.let(::parseUser)
    }

    suspend fun login(email: String, password: String): User = withContext(Dispatchers.IO) {
        val body = JSONObject().put("email", email).put("password", password)
        parseUser(postJson("/api/auth/login", body).getJSONObject("user"))
    }

    suspend fun register(name: String, email: String, phone: String, password: String): User = withContext(Dispatchers.IO) {
        val body = JSONObject().put("name", name).put("email", email).put("phone", phone).put("password", password)
        parseUser(postJson("/api/auth/register", body).getJSONObject("user"))
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        executeJson(Request.Builder().url("$origin/api/auth/logout").post(ByteArray(0).toRequestBody()).build())
        cookies.clear()
    }

    suspend fun favorites(): Set<String> = withContext(Dispatchers.IO) {
        executeJson(Request.Builder().url("$origin/api/me/favorites").get().build())
            .getJSONArray("data").let { array -> (0 until array.length()).map { array.getString(it) }.toSet() }
    }

    suspend fun setFavorite(id: String, favorite: Boolean) = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url("$origin/api/me/favorites/$id")
        executeJson(if (favorite) builder.post(ByteArray(0).toRequestBody()).build() else builder.delete().build())
    }

    suspend fun createProperty(draft: PropertyDraft): Property = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("title", draft.title).put("type", draft.type).put("mode", draft.mode)
            .put("city", draft.city).put("district", draft.district)
            .put("price", draft.price.toDoubleOrNull() ?: 0.0).put("currency", draft.currency)
            .putOpt("area", draft.area.toDoubleOrNull()).putOpt("rooms", draft.rooms.toIntOrNull())
            .putOpt("baths", draft.baths.toIntOrNull()).put("description", draft.description)
        if (draft.latitude.isNotBlank() && draft.longitude.isNotBlank()) {
            body.put("latitude", draft.latitude.toDouble()).put("longitude", draft.longitude.toDouble())
        }
        parser.parse(postJson("/api/properties", body))
    }

    suspend fun validateMedia(resolver: ContentResolver, uris: List<Uri>) = withContext(Dispatchers.IO) {
        val media = uris.map { mediaInfo(resolver, it) }
        require(media.count { it.mime.startsWith("image/") } <= 12) { "الحد الأقصى 12 صورة" }
        require(media.count { it.mime.startsWith("video/") } <= 3) { "الحد الأقصى 3 فيديوهات" }
        media.forEach { item ->
            require(item.mime.startsWith("image/") || item.mime in setOf("video/mp4", "video/webm", "video/quicktime")) { "صيغة ${item.name} غير مدعومة" }
            require(item.size != 0L) { "الملف ${item.name} فارغ" }
            if (item.mime.startsWith("video/")) require(item.size <= 100L * 1024 * 1024) { "حجم الفيديو يتجاوز 100 ميغابايت" }
            val input = resolver.openInputStream(item.uri) ?: throw java.io.IOException("تعذر قراءة الملف؛ أعد اختياره من الجهاز")
            input.use { require(it.read() != -1) { "الملف فارغ" } }
        }
    }

    suspend fun uploadMediaItem(propertyId: String, resolver: ContentResolver, uri: Uri) = withContext(Dispatchers.IO) {
        val item = mediaInfo(resolver, uri)
        if (item.mime.startsWith("image/")) uploadImages(propertyId, resolver, listOf(item))
        else uploadVideo(propertyId, resolver, item)
    }

    private fun uploadImages(propertyId: String, resolver: ContentResolver, media: List<LocalMedia>) {
        val temporary = mutableListOf<File>()
        try {
            val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
            media.forEachIndexed { index, item ->
                val jpeg = prepareJpeg(resolver, item.uri).also(temporary::add)
                multipart.addFormDataPart("images", "property-${index + 1}.jpg", jpeg.asRequestBody("image/jpeg".toMediaTypeOrNull()))
            }
            requireUploaded(executeJson(Request.Builder().url("$origin/api/me/properties/$propertyId/images").post(multipart.build()).build()))
        } finally { temporary.forEach { it.delete() } }
    }

    private fun uploadVideo(propertyId: String, resolver: ContentResolver, item: LocalMedia) {
        if (item.size > 100L * 1024 * 1024) throw IllegalArgumentException("حجم الفيديو يتجاوز 100 ميغابايت")
        val accepted = item.mime in setOf("video/mp4", "video/webm", "video/quicktime")
        if (!accepted) throw IllegalArgumentException("صيغة الفيديو غير مدعومة. استخدم MP4 أو MOV أو WebM")
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
        multipart.addFormDataPart("videos", safeName(item.name, item.mime), UriBody(resolver, item.uri, item.mime, item.size))
        requireUploaded(executeJson(Request.Builder().url("$origin/api/me/properties/$propertyId/videos").post(multipart.build()).build()))
    }

    private fun requireUploaded(response: JSONObject) {
        val data = response.optJSONArray("data")
        if (data?.length() != 1 || data.optJSONObject(0)?.optString("url").isNullOrBlank()) {
            throw java.io.IOException("لم يؤكد الخادم حفظ الملف؛ لم يُسجّل الرفع كناجح")
        }
    }

    private fun postJson(path: String, json: JSONObject): JSONObject {
        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaTypeOrNull())
        return executeJson(Request.Builder().url(origin + path).post(body).build())
    }

    private fun executeJson(request: Request): JSONObject {
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (!response.isSuccessful) throw ApiException(json.optString("error", "تعذر الاتصال بالخدمة"), response.code)
            return json
        }
    }

    private fun parseUser(j: JSONObject) = User(j.optLong("id"), j.optString("name"), j.optString("email"), j.optString("phone"), j.optString("role", "user"))

    private fun mediaInfo(resolver: ContentResolver, uri: Uri): LocalMedia {
        var name = "media"
        var size = -1L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = cursor.getString(it) ?: name }
                cursor.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { size = if (cursor.isNull(it)) -1 else cursor.getLong(it) }
            }
        }
        val extension = name.substringAfterLast('.', "").lowercase()
        val mime = resolver.getType(uri)?.lowercase()?.takeUnless { it in setOf("application/octet-stream", "") }
            ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
            ?: when (extension) { "jpg", "jpeg", "heic", "heif", "png", "webp" -> "image/$extension"; "mp4" -> "video/mp4"; "mov" -> "video/quicktime"; "webm" -> "video/webm"; else -> "application/octet-stream" }
        return LocalMedia(uri, name, mime, size)
    }

    private fun prepareJpeg(resolver: ContentResolver, uri: Uri): File {
        val bitmap = if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
                val max = 2560
                val w = info.size.width; val h = info.size.height
                if (maxOf(w, h) > max) {
                    val ratio = max.toDouble() / maxOf(w, h)
                    decoder.setTargetSize((w * ratio).toInt().coerceAtLeast(1), (h * ratio).toInt().coerceAtLeast(1))
                }
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        } else decodeSampledBitmap(resolver, uri, 2560)
        val file = File.createTempFile("aqartkom-image-", ".jpg", appContext.cacheDir)
        try {
            file.outputStream().use { output ->
                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output)) throw IllegalArgumentException("تعذر تجهيز الصورة")
            }
            require(file.length() in 1..(8L * 1024 * 1024)) { "حجم الصورة غير صالح" }
            return file
        } catch (e: Exception) {
            file.delete()
            throw e
        } finally { bitmap.recycle() }
    }

    private fun decodeSampledBitmap(resolver: ContentResolver, uri: Uri, max: Int): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth / sample, bounds.outHeight / sample) > max) sample *= 2
        return resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: throw IllegalArgumentException("تعذر قراءة الصورة")
    }

    private fun safeName(name: String, mime: String): String {
        val clean = name.replace(Regex("[^A-Za-z0-9._-]"), "-").takeLast(120)
        if (clean.contains('.')) return clean
        val ext = when (mime) { "video/quicktime" -> "mov"; "video/webm" -> "webm"; else -> "mp4" }
        return "video-${System.currentTimeMillis()}.$ext"
    }
}

class ApiException(message: String, val status: Int) : Exception(message)

private class PersistentCookieJar(context: Context, private val origin: HttpUrl) : CookieJar {
    private val preferences = context.getSharedPreferences("aqartkom_session", Context.MODE_PRIVATE)
    private val values = mutableMapOf<String, Cookie>()
    init { preferences.getStringSet("cookies", emptySet()).orEmpty().mapNotNull { Cookie.parse(origin, it) }.forEach { values[it.name] = it } }
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = synchronized(values) {
        cookies.forEach { values[it.name] = it }
        preferences.edit().putStringSet("cookies", values.values.map { it.toString() }.toSet()).apply()
    }
    override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(values) {
        val now = System.currentTimeMillis(); values.entries.removeAll { it.value.expiresAt < now }
        values.values.filter { it.matches(url) }
    }
    fun clear() = synchronized(values) { values.clear(); preferences.edit().clear().apply() }
}

private data class LocalMedia(val uri: Uri, val name: String, val mime: String, val size: Long)

private class UriBody(private val resolver: ContentResolver, private val uri: Uri, mime: String, private val size: Long) : RequestBody() {
    private val type = mime.toMediaTypeOrNull()
    override fun contentType() = type
    override fun contentLength() = size
    override fun writeTo(sink: okio.BufferedSink) {
        val input = resolver.openInputStream(uri) ?: throw java.io.IOException("تعذر فتح الملف؛ أعد اختياره من جهازك")
        input.use {
            val buffer = ByteArray(64 * 1024)
            var total = 0L
            while (true) {
                val count = it.read(buffer)
                if (count < 0) break
                total += count
                if (total > 100L * 1024 * 1024) throw java.io.IOException("حجم الفيديو يتجاوز 100 ميغابايت")
                sink.write(buffer, 0, count)
            }
            if (total == 0L) throw java.io.IOException("الملف فارغ")
        }
    }
}

private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }

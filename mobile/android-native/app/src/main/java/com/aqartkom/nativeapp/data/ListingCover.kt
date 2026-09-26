package com.aqartkom.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject

data class CoverChoice(val type: String, val url: String = "", val seconds: Double? = null) {
    fun request(revision: String): JSONObject {
        require(type in setOf("auto", "image", "video") && revision.isNotBlank())
        require(type == "auto" || url.isNotBlank())
        require(seconds == null || (type == "video" && seconds.isFinite() && seconds in 0.0..86400.0))
        return JSONObject().put("type", type).put("revision", revision).apply {
            if (type != "auto") put("url", url)
            seconds?.let { put("seconds", it) }
        }
    }
}

data class CoverMedia(val type: String, val url: String, val displayUrl: String, val poster: String, val title: String, val canExtract: Boolean)
data class CoverState(val revision: String, val media: List<CoverMedia>, val currentUrl: String, val automatic: Boolean)
data class CoverSaved(val imageUrl: String, val status: String, val message: String)

internal class CoverParser(origin: String) {
    private val urls = PropertyParser(origin)
    fun state(json: JSONObject): CoverState {
        val array = json.optJSONArray("media") ?: JSONArray()
        val media = (0 until array.length()).mapNotNull { index ->
            val item = array.optJSONObject(index) ?: return@mapNotNull null
            val type = item.optString("type")
            val raw = item.optString("url")
            val url = urls.absolute(raw)
            if (type !in setOf("image", "video") || url.isBlank()) return@mapNotNull null
            CoverMedia(type, raw, url, urls.absolute(item.optString("poster")), item.optString("title"), item.optBoolean("can_extract"))
        }.sortedBy { if (it.type == "video") 0 else 1 }
        return CoverState(json.getString("revision"), media,
            urls.absolute((json.optJSONObject("cover") ?: json.optJSONObject("effective_cover"))?.optString("url").orEmpty()),
            json.optJSONObject("cover") == null)
    }
    fun saved(json: JSONObject): CoverSaved {
        check(json.optBoolean("ok")) { "لم يؤكد الخادم حفظ الغلاف؛ أعد المحاولة" }
        return CoverSaved(urls.absolute((json.optJSONObject("cover") ?: json.optJSONObject("effective_cover"))?.optString("url").orEmpty()),
            json.optString("status", "active"), json.optString("message", "تم حفظ صورة العرض"))
    }
}

internal fun coverKind(id: String) = if (id.startsWith("market-")) "market" else "property"
internal fun coverPath(id: String): String {
    val number = id.removePrefix("market-")
    require(Regex("[0-9]+").matches(number)) { "رقم إعلان غير صحيح" }
    return "/api/listing-management/${coverKind(id)}/$number/cover"
}

/** Use the actual media for the gallery, never a generated cover as an extra photograph. */
fun Property.galleryVideos(): List<PropertyVideo> = (listOfNotNull(primaryVideo) + videos).distinctBy { it.url }

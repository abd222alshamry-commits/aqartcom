package com.aqartkom.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** Shared decoding for list, owner-detail, and office-detail API envelopes. */
internal class PropertyParser(private val origin: String) {
    fun parse(response: JSONObject, forceMarket: Boolean = false): Property {
        val j = response.optJSONObject("data") ?: response
        val market = forceMarket || j.text("source_kind") == "office" || j.has("advertiser_name")
        val images = (j.optJSONArray("images") ?: j.optJSONArray("media")).objects()
            .filter { it.text("type").lowercase() in setOf("", "image", "photo") }
            .mapNotNull { image -> absolute(image.text("url")).takeIf(String::isNotBlank)?.let { PropertyImage(image.optLong("id"), it) } }
            .distinctBy { it.url }
        val hosted = j.optJSONObject("hosted_video")
        val videos = j.optJSONArray("videos").objects().map(::video).filter { it.url.isNotBlank() }
            .ifEmpty { hosted?.let { listOf(video(it)) }?.filter { it.url.isNotBlank() }.orEmpty() }
        val primary = j.optJSONObject("primary_video")?.let(::video)?.takeIf { it.url.isNotBlank() }
            ?: videos.firstOrNull { it.primary } ?: videos.firstOrNull()
            ?: absolute(j.text("external_url")).takeIf { market && it.isNotBlank() }?.let {
                PropertyVideo(url = it, title = j.text("title"), sourceType = j.text("platform", "external"), primary = true)
            }
        val image = absolute(j.text("image_url"))
        val owner = j.optJSONObject("owner")?.let { Advertiser(it.text("name", "معلن عقاري"), it.text("phone"), it.text("role", "user")) }
            ?: if (market) Advertiser(j.text("advertiser_name", "مكتب عقاري"), j.text("phone"), "agent") else null
        val id = j.text("market_id", j.text("id")).removePrefix("market-")
        require(id.isNotBlank()) { "بيانات الإعلان غير مكتملة" }
        return Property(
            id = if (market) "market-$id" else id, title = j.text("title"),
            type = j.text("type", j.text("property_type")),
            mode = j.text("mode", if (j.text("listing_mode") == "rent") "إيجار" else "بيع"),
            city = j.text("city"), district = j.text("district"),
            price = j.number("price_display") ?: j.number("price") ?: 0.0,
            currency = j.text("display_currency", j.text("currency", "USD")),
            area = j.number("area"), rooms = j.number("rooms")?.toInt(), baths = j.number("baths")?.toInt(),
            description = j.text("description"), imageUrl = images.firstOrNull()?.url ?: image.ifBlank { primary?.posterUrl.orEmpty() },
            featured = j.optBoolean("featured"), sponsored = j.optBoolean("sponsored"),
            latitude = j.number("latitude"), longitude = j.number("longitude"), views = j.optInt("views_count"),
            images = images, videos = videos, primaryVideo = primary, owner = owner,
            sourceKind = if (market) "office" else "property",
            createdAt = j.text("created_at", j.text("published_at")), status = j.text("status", "active")
        )
    }

    private fun video(j: JSONObject) = PropertyVideo(
        id = j.optLong("id"), url = absolute(j.text("url")),
        posterUrl = absolute(j.text("poster_url", j.text("poster"))),
        title = j.text("title", "فيديو العقار"), sourceType = j.text("source_type", "upload"), primary = j.optBoolean("is_primary")
    )

    internal fun absolute(value: String): String {
        val text = value.trim()
        if (text.isEmpty() || text == "null") return ""
        return runCatching {
            val uri = URI(origin.trimEnd('/') + "/").resolve(text)
            if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null) "" else uri.toASCIIString()
        }.getOrDefault("")
    }
}

private fun JSONObject.text(key: String, fallback: String = ""): String =
    if (isNull(key)) fallback else optString(key).trim().takeUnless { it.isBlank() || it == "null" } ?: fallback
private fun JSONObject.number(key: String): Double? = if (isNull(key)) null else optDouble(key).takeIf { it.isFinite() }
private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

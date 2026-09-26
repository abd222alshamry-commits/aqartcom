package com.aqartkom.nativeapp.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CoverRegressionTest {
    private val origin = "https://aqartcom-v93.onrender.com"
    private val parser = PropertyParser(origin)
    private fun listing(extra: String) = parser.parse(JSONObject("""{"id":42,"images":[{"url":"/uploads/one.jpg"},{"url":"/uploads/two.jpg"}],"primary_video":{"url":"/uploads/tour.mp4","poster_url":"/uploads/poster.jpg"},$extra}"""))

    @Test fun explicitImageWinsOverAutomaticVideoAndSurvivesFeedAndDetail() {
        val detail = listing(""""cover_media":{"type":"image","url":"/uploads/two.jpg"}""")
        val feed = parser.parse(JSONObject("""{"id":42,"image_url":"/uploads/one.jpg","primary_video":{"url":"/uploads/tour.mp4","poster_url":"/uploads/poster.jpg"},"cover_media":{"type":"image","url":"/uploads/two.jpg"}}"""))
        assertEquals("$origin/uploads/two.jpg", detail.imageUrl)
        assertEquals(detail.imageUrl, feed.imageUrl)
        assertEquals(2, detail.images.size)
    }
    @Test fun selectedFrameIsCoverButNeverAnExtraGalleryPhoto() {
        val p = listing(""""cover_media":{"type":"video","url":"/uploads/cover-abc.jpg","source_url":"/uploads/tour.mp4","seconds":2.5}""")
        assertEquals("$origin/uploads/cover-abc.jpg", p.imageUrl)
        assertEquals(listOf("$origin/uploads/one.jpg", "$origin/uploads/two.jpg"), p.images.map { it.url })
        assertEquals(1, p.galleryVideos().size)
    }
    @Test fun automaticUsesVideoThenRealPhotoAndRejectsUnsafeCover() {
        assertEquals("$origin/uploads/poster.jpg", listing("\"cover_media\":null").imageUrl)
        assertEquals("$origin/uploads/poster.jpg", listing(""""cover_media":{"url":"javascript:bad"}""").imageUrl)
        val photo = parser.parse(JSONObject("""{"id":42,"image_url":"/uploads/real.jpg","primary_video":{"url":"/uploads/old.mp4"}}"""))
        assertEquals("$origin/uploads/real.jpg", photo.imageUrl)
        assertEquals(1, photo.images.size)
        val empty = parser.parse(JSONObject("""{"id":42,"image_url":"/assets/property-villa.webp"}"""))
        assertEquals("", empty.imageUrl)
        assertTrue(empty.images.isEmpty())
    }
    @Test fun nonPrimaryVideoPosterAndOfficeVideoAreRetained() {
        val p = parser.parse(JSONObject("""{"id":"market-5","source_kind":"office","media":[{"type":"video","url":"/uploads/first.mp4"},{"type":"image","url":"/uploads/one.jpg"}],"videos":[{"url":"/uploads/second.mp4","poster_url":"/uploads/second.jpg"}],"primary_video":{"url":"/uploads/first.mp4"}}"""))
        assertEquals("$origin/uploads/second.jpg", p.imageUrl)
        assertEquals(listOf("$origin/uploads/first.mp4", "$origin/uploads/second.mp4"), p.galleryVideos().map { it.url })
        assertEquals(1, p.images.size)
    }
    @Test fun editorPreservesRawServerUrlsAndRevisionForSave() {
        val data = CoverParser(origin).state(JSONObject("""{"revision":"revision-1","cover":null,"effective_cover":{"url":"/uploads/poster.jpg"},"media":[{"type":"image","url":"/uploads/one.jpg"},{"type":"video","url":"/uploads/tour.mp4","poster":"/uploads/poster.jpg","can_extract":true}]}"""))
        assertTrue(data.automatic)
        assertEquals("video", data.media.first().type)
        assertEquals("$origin/uploads/poster.jpg", data.currentUrl)
        val body = CoverChoice("video", data.media.first().url, 2.5).request(data.revision)
        assertEquals("/uploads/tour.mp4", body.getString("url"))
        assertEquals("revision-1", body.getString("revision"))
        assertEquals(2.5, body.getDouble("seconds"), 0.0)
        assertFalse(CoverChoice("auto").request(data.revision).has("url"))
        assertFalse(CoverChoice("video", "/uploads/tour.mp4").request(data.revision).has("seconds"))
    }
    @Test fun saveResponseUsesEffectiveCoverAfterResetAndRejectsUnconfirmedSave() {
        val data = CoverParser(origin).saved(JSONObject("""{"ok":true,"cover":null,"effective_cover":{"url":"/uploads/auto.jpg"},"status":"pending","message":"محفوظ"}"""))
        assertEquals("$origin/uploads/auto.jpg", data.imageUrl)
        assertEquals("pending", data.status)
        assertThrows(IllegalStateException::class.java) { CoverParser(origin).saved(JSONObject("{}")) }
        assertThrows(IllegalArgumentException::class.java) { CoverChoice("video", "/video.mp4", Double.NaN).request("r") }
        assertEquals("/api/listing-management/market/5/cover", coverPath("market-5"))
        assertThrows(IllegalArgumentException::class.java) { coverPath("../admin") }
    }
}

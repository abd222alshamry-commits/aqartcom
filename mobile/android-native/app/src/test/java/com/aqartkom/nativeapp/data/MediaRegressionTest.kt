package com.aqartkom.nativeapp.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MediaRegressionTest {
    private val parser = PropertyParser("https://aqartcom-v93.onrender.com")

    @Test fun detailEnvelopeKeepsGalleryAndUploadedVideo() {
        val result = parser.parse(JSONObject("""{"data":{"id":"11","title":"شقة","images":[{"id":1,"url":"/uploads/front.jpg"},{"id":2,"url":"/uploads/room.jpg"}],"videos":[{"id":8,"url":"/uploads/tour.mp4","source_type":"upload","poster_url":"/uploads/tour.jpg","is_primary":true}],"owner":{"name":"مالك","phone":"+963123"}}} """))
        assertEquals("11", result.id)
        assertEquals(2, result.images.size)
        assertEquals("https://aqartcom-v93.onrender.com/uploads/front.jpg", result.imageUrl)
        assertEquals("https://aqartcom-v93.onrender.com/uploads/tour.jpg", result.primaryVideo?.posterUrl)
        assertEquals("+963123", result.owner?.phone)
    }

    @Test fun nullImageDoesNotHideVideoThumbnailOrCreateNullUrl() {
        val result = parser.parse(JSONObject("""{"id":11,"image_url":null,"price":null,"rooms":null,"primary_video":{"url":"/uploads/tour.mp4","poster_url":null}}"""))
        assertEquals("", result.imageUrl)
        assertEquals("", result.primaryVideo?.posterUrl)
        assertEquals(0.0, result.price, 0.0)
        assertNull(result.rooms)
        assertTrue(result.primaryVideo!!.url.endsWith("tour.mp4"))
    }

    @Test fun officeIdsRoundTripWithoutDoublePrefixAndVideoIsNotImage() {
        val list = parser.parse(JSONObject("""{"id":"market-18","source_kind":"office","media":[{"type":"video","url":"/uploads/office.mp4"},{"type":"image","url":"/uploads/office.jpg"}],"advertiser_name":"مكتب"}"""))
        val detail = parser.parse(JSONObject("""{"data":{"id":18,"advertiser_name":"مكتب","hosted_video":{"url":"/uploads/office.mp4","poster":"/uploads/poster.jpg"}}}"""), true)
        assertEquals(list.id, detail.id)
        assertEquals(1, list.images.size)
        assertTrue(list.imageUrl.endsWith(".jpg"))
        assertEquals("https://aqartcom-v93.onrender.com/uploads/poster.jpg", detail.imageUrl)
    }

    @Test fun mediaUrlsPreserveSignedQueriesAndRejectNonWebSchemes() {
        assertEquals("https://cdn.example.com/video.mp4?key=a%2Fb&token=123", parser.absolute("https://cdn.example.com/video.mp4?key=a%2Fb&token=123"))
        for (url in listOf("null", "", "javascript:alert(1)", "file:///private/photo.jpg", "https://user:secret@example.com/x")) assertEquals("", parser.absolute(url))
    }

    @Test fun backInvalidatesSlowDetailResponseEvenIfTransportFinishesLater() {
        val requests = RequestGeneration()
        var detail: String? = null
        val old = requests.next()
        val finish = { if (requests.accepts(old)) detail = "old listing" }
        requests.next() // Back closes the screen while transport is still in flight.
        detail = null
        finish()
        assertNull(detail)
    }

    @Test fun lateSearchCannotReplaceMoreRecentResults() {
        val requests = RequestGeneration()
        val first = requests.next()
        val second = requests.next()
        var result = ""
        if (requests.accepts(second)) result = "حماة"
        if (requests.accepts(first)) result = "دمشق"
        assertEquals("حماة", result)
    }

    @Test fun retryAfterPartialUploadKeepsSameListingAndOnlyRemainingFiles() {
        val session = UploadSession("42", listOf("photo-1", "photo-2", "tour", "photo-1"))
        session.acknowledge("photo-1")
        session.acknowledge("photo-2")
        // tour failed; no acknowledgement is recorded, so retry cannot resend photos.
        assertEquals("42", session.propertyId)
        assertEquals(listOf("tour"), session.remaining)
        assertEquals(2, session.uploaded)
        session.acknowledge("tour")
        session.acknowledge("tour")
        assertTrue(session.remaining.isEmpty())
        assertEquals(3, session.uploaded)
        assertEquals(3, session.total)
    }
}

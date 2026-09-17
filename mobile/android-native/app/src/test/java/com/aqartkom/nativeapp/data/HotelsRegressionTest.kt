package com.aqartkom.nativeapp.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class HotelsRegressionTest {
    private val parser = HotelParser("https://aqartcom-v93.onrender.com")
    @Test fun hotelDatesValidateCalendarAndStayLength() {
        val today = LocalDate.of(2026, 9, 17)
        assertNull(HotelSearch(checkIn = "2026-09-18", checkOut = "2026-09-20").error(today))
        assertNotNull(HotelSearch(checkIn = "2026-02-30", checkOut = "2026-03-01").error(today))
        assertNotNull(HotelSearch(checkIn = "2026-09-18", checkOut = "2026-09-18").error(today))
        assertNotNull(HotelSearch(checkIn = "2026-09-18", checkOut = "2026-09-20", rooms = 0).error(today))
    }
    @Test fun hotelAndRoomImagesHandleNullsAndRejectUnsafeUrls() {
        val d = parser.detail(JSONObject("""{"hotel":{"id":1,"name":"فندق","min_price":null,"images":["/uploads/h.jpg",{"url":"javascript:bad"}],"review_score":null},"rooms":[{"id":2,"name":"غرفة","images":[{"url":"/uploads/r.jpg"}],"price":"100","max_guests":2}]}"""))
        assertEquals(listOf("https://aqartcom-v93.onrender.com/uploads/h.jpg"), d.hotel.images)
        assertNull(d.hotel.minPrice); assertEquals(0, d.hotel.reviewCount)
        assertEquals(100.0, d.rooms.first().price!!, 0.0)
    }
    @Test fun bookingCarriesReviewedPriceAndSameRetryKey() {
        val q = parser.quote(JSONObject("""{"data":{"hotel_id":1,"room_id":2,"hotel_name":"Hotel","room_name":"Room","check_in":"2026-10-01","check_out":"2026-10-03","adults":2,"rooms_count":1,"nights":2,"total":180.5,"currency":"USD","booking_api":1}}"""))
        val body = q.bookingBody("Guest", "+963944123456", "", "", "same-key")
        assertEquals(180.5, body.getDouble("expected_total"), 0.0)
        assertEquals("USD", body.getString("expected_currency"))
        assertEquals("pay_at_hotel", body.getString("payment_method"))
        val restored = JSONObject(body.toString())
        assertEquals("same-key", restored.getString("idempotency_key"))
        assertEquals("2026-10-03", restored.getString("check_out"))
    }
    @Test fun unverifiedQuotesCannotBecomeBookingForms() {
        assertThrows(IllegalArgumentException::class.java) { parser.quote(JSONObject("""{"data":{"total":0,"currency":"USD","nights":2,"rooms_count":1}}""")) }
    }
    @Test fun incompleteSuccessfulQuoteCannotCrashCheckout() {
        assertThrows(IllegalArgumentException::class.java) { parser.quote(JSONObject("""{"data":{"booking_api":1,"total":100,"currency":"USD","nights":2,"rooms_count":1,"adults":2}}""")) }
    }
    @Test fun malformedBookingSuccessIsNotReportedAsConfirmed() {
        assertThrows(IllegalArgumentException::class.java) { parser.receipt(JSONObject("""{"data":{"total":100,"status":"confirmed"}}""")) }
        val receipt = parser.receipt(JSONObject("""{"data":{"booking_code":"AQH-123","total":"180.50","currency":"USD","status":"confirmed","check_in":"2026-10-01T00:00:00Z"}}"""))
        assertEquals("2026-10-01", receipt.checkIn)
        assertEquals(180.5, receipt.total, 0.0)
    }
}

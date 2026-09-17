package com.aqartkom.nativeapp.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

data class HotelSearch(val query: String = "", val city: String = "", val checkIn: String = LocalDate.now().plusDays(1).toString(), val checkOut: String = LocalDate.now().plusDays(2).toString(), val adults: Int = 2, val rooms: Int = 1) {
    fun error(today: LocalDate = LocalDate.now()): String? {
        val start = runCatching { LocalDate.parse(checkIn) }.getOrNull() ?: return "اختر تاريخ الوصول"
        val end = runCatching { LocalDate.parse(checkOut) }.getOrNull() ?: return "اختر تاريخ المغادرة"
        if (start < today || end <= start || ChronoUnit.DAYS.between(start, end) > 365) return "اختر وصولًا من اليوم ومغادرة بعده، لمدة لا تتجاوز سنة"
        if (adults !in 1..20 || rooms !in 1..20) return "راجع أعداد الضيوف والغرف"
        return null
    }
    fun quoteFields(hotel: String, room: String) = JSONObject().put("hotel_id", hotel).put("room_id", room).put("check_in", checkIn).put("check_out", checkOut).put("adults", adults).put("rooms_count", rooms)
}
data class Hotel(val id: String, val name: String, val city: String, val district: String, val address: String, val description: String, val stars: Double, val images: List<String>, val amenities: List<String>, val minPrice: Double?, val currency: String, val reviewScore: Double?, val reviewCount: Int, val checkInTime: String, val checkOutTime: String, val cancellation: String)
data class HotelRoom(val id: String, val name: String, val type: String, val description: String, val guests: Int, val size: Double?, val beds: String, val price: Double?, val currency: String, val images: List<String>, val amenities: List<String>)
data class HotelDetail(val hotel: Hotel, val rooms: List<HotelRoom>)
data class HotelQuote(val json: String) {
    private val value get() = JSONObject(json)
    val total get() = value.getDouble("total")
    val currency get() = value.getString("currency")
    val nights get() = value.getInt("nights")
    val rooms get() = value.getInt("rooms_count")
    val hotelName get() = value.getString("hotel_name")
    val roomName get() = value.getString("room_name")
    val policy get() = value.hotelText("cancellation_policy")
    val checkIn get() = value.getString("check_in")
    val checkOut get() = value.getString("check_out")
    fun bookingBody(name: String, phone: String, email: String, notes: String, key: String): JSONObject = value.let { q ->
        JSONObject().apply {
            listOf("hotel_id", "room_id", "check_in", "check_out", "adults", "rooms_count").forEach { put(it, q.get(it)) }
            put("guest_name", name.trim()); put("guest_phone", phone.trim()); put("guest_email", email.trim()); put("special_requests", notes.trim())
            put("expected_total", total); put("expected_currency", currency); put("idempotency_key", key); put("payment_method", "pay_at_hotel")
        }
    }
}
data class HotelReceipt(val code: String, val hotel: String, val room: String, val checkIn: String, val checkOut: String, val total: Double, val currency: String, val status: String, val json: String)

internal class HotelParser(origin: String) {
    private val urls = PropertyParser(origin)
    private fun images(j: JSONObject): List<String> = j.optJSONArray("images").values().mapNotNull { value ->
        val raw = if (value is JSONObject) value.hotelText("url") else value as? String ?: ""
        urls.absolute(raw).takeIf(String::isNotBlank)
    }.distinct()
    private fun amenities(j: JSONObject) = j.optJSONArray("amenities").values().mapNotNull { it as? String }.filter { it.isNotBlank() }.take(30)
    fun hotel(j: JSONObject) = Hotel(j.hotelText("id"), j.hotelText("name"), j.hotelText("city"), j.hotelText("district"), j.hotelText("address"), j.hotelText("description"), (j.hotelNumber("star_rating") ?: 0.0).coerceIn(0.0, 5.0), images(j), amenities(j), j.hotelNumber("min_price"), j.hotelText("currency", "USD"), j.hotelNumber("review_score"), j.optInt("review_count"), j.hotelText("check_in_time", "14:00"), j.hotelText("check_out_time", "12:00"), j.hotelText("cancellation_policy"))
    fun detail(j: JSONObject) = HotelDetail(hotel(j.getJSONObject("hotel")), j.getJSONArray("rooms").values().filterIsInstance<JSONObject>().map { r -> HotelRoom(r.hotelText("id"), r.hotelText("name"), r.hotelText("room_type"), r.hotelText("description"), r.optInt("max_guests", 1), r.hotelNumber("size_m2"), r.hotelText("bed_type"), r.hotelNumber("price"), r.hotelText("currency", "USD"), images(r), amenities(r)) })
    fun quote(j: JSONObject): HotelQuote {
        val q = j.getJSONObject("data")
        val nights = runCatching { ChronoUnit.DAYS.between(LocalDate.parse(q.hotelText("check_in")), LocalDate.parse(q.hotelText("check_out"))) }.getOrDefault(0)
        require(q.optInt("booking_api") == 1 && q.hotelNumber("total")?.let { it >= 0 } == true && Regex("[A-Z]{3}").matches(q.hotelText("currency")) &&
            nights in 1..365 && q.optInt("nights").toLong() == nights && q.optInt("rooms_count") in 1..20 && q.optInt("adults") in 1..20 &&
            q.optLong("hotel_id") > 0 && q.optLong("room_id") > 0 && q.hotelText("hotel_name").isNotBlank() && q.hotelText("room_name").isNotBlank()) { "تعذر التحقق من عرض السعر" }
        return HotelQuote(q.toString())
    }
    fun receipt(j: JSONObject): HotelReceipt {
        val r = j.optJSONObject("data") ?: j
        val code = r.hotelText("booking_code")
        require(code.startsWith("AQH-") && r.hotelNumber("total") != null && r.hotelText("status").isNotBlank()) { "لم يصل تأكيد واضح للحجز؛ أعد التحقق من الطلب نفسه" }
        return HotelReceipt(code,r.hotelText("hotel_name"),r.hotelText("room_name"),r.hotelText("check_in").take(10),r.hotelText("check_out").take(10),r.getDouble("total"),r.hotelText("currency"),r.hotelText("status"),r.toString())
    }
}
private fun JSONArray?.values(): List<Any> = if (this == null) emptyList() else (0 until length()).map { get(it) }
private fun JSONObject.hotelText(key: String, fallback: String = "") = if (isNull(key)) fallback else optString(key).takeUnless { it == "null" || it.isBlank() } ?: fallback
private fun JSONObject.hotelNumber(key: String): Double? = if (isNull(key)) null else optDouble(key).takeIf(Double::isFinite)

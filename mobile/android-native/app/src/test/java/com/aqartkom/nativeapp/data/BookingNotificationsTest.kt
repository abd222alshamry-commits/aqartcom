package com.aqartkom.nativeapp.data
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class BookingNotificationsTest {
    @Test fun onlyUnreadBookingMessagesWithLocalTargetsAreShown() {
        val json = JSONObject("""{"user_id":1,"data":[
          {"id":1,"type":"hotel_booking_requested","title":"طلب جديد","body":"فندق","action_url":"/hotel-partner.html?hotel=5&tab=bookings","is_read":false},
          {"id":2,"type":"hotel_booking_approved","action_url":"/hotels.html#booking=AQH-123","is_read":true},
          {"id":3,"type":"hotel_booking_requested","action_url":"https://other.example"},
          {"id":4,"type":"property_match","action_url":"/hotel-partner.html"},
          {"id":5,"type":"hotel_booking_requested","action_url":"//other.example/hotel-partner.html"}
        ]}""")
        val notices=BookingNotifications.notices(json)
        assertEquals(1,notices.size)
        assertEquals("1",notices.single().id)
        assertEquals("/hotel-partner.html?hotel=5&tab=bookings",notices.single().path)
    }
}

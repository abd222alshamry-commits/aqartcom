package com.aqartkom.nativeapp

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.aqartkom.nativeapp.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

enum class HotelPage { Search, Detail, Booking, Receipt, History }

class HotelsViewModel(application: Application) : AndroidViewModel(application) {
    private val api = (application as AqartkomApplication).api
    private val parser = HotelParser(BuildConfig.API_ORIGIN)
    private val preferences = application.getSharedPreferences("aqartkom_hotel_bookings", 0)
    private val searchGeneration = RequestGeneration()
    private val detailGeneration = RequestGeneration()
    private val quoteGeneration = RequestGeneration()
    private var searchJob: Job? = null
    private var detailJob: Job? = null
    private var quoteJob: Job? = null
    private var hotelId: String? = null
    private var quoteRequest: Triple<HotelSearch, String, String>? = null
    private var started = false
    private val restored = runCatching { preferences.getString("pending", null)?.let(::JSONObject) }.getOrNull()
    private val _pending = MutableStateFlow(restored?.getJSONObject("body")?.toString())
    val pending = _pending.asStateFlow()
    private val _page = MutableStateFlow(if (restored == null) HotelPage.Search else HotelPage.Booking)
    val page = _page.asStateFlow()
    private val _filters = MutableStateFlow(HotelSearch())
    val filters = _filters.asStateFlow()
    private val _hotels = MutableStateFlow<LoadState<List<Hotel>>>(LoadState.Loading)
    val hotels = _hotels.asStateFlow()
    private val _detail = MutableStateFlow<LoadState<HotelDetail>>(LoadState.Loading)
    val detail = _detail.asStateFlow()
    private val _quote = MutableStateFlow<LoadState<HotelQuote>>(restored?.optJSONObject("quote")?.let { LoadState.Ready(HotelQuote(it.toString())) } ?: LoadState.Loading)
    val quote = _quote.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()
    private val _receipt = MutableStateFlow<HotelReceipt?>(null)
    val receipt = _receipt.asStateFlow()
    private val _history = MutableStateFlow(readHistory())
    val history = _history.asStateFlow()

    private fun readHistory(): List<HotelReceipt> = runCatching {
        val json = JSONArray(preferences.getString("receipts", "[]"))
        (0 until json.length()).mapNotNull { runCatching { parser.receipt(json.getJSONObject(it)) }.getOrNull() }
    }.getOrDefault(emptyList())
    fun clearMessage() { _message.value = null }
    fun showMessage(text: String) { _message.value = text }
    fun ensureLoaded() { if (!started) search(_filters.value) }
    fun search(filters: HotelSearch) {
        filters.error()?.let { _message.value = it; return }
        started = true; _filters.value = filters
        val token = searchGeneration.next(); searchJob?.cancel()
        searchJob = viewModelScope.launch {
            _hotels.value = LoadState.Loading
            val result = try { LoadState.Ready(api.hotels(filters)) } catch (e: CancellationException) { throw e } catch (e: Exception) { LoadState.Error(e.message ?: "تعذر تحميل الفنادق") }
            if (searchGeneration.accepts(token)) _hotels.value = result
        }
    }
    fun openHotel(id: String) {
        hotelId = id; _page.value = HotelPage.Detail
        val token = detailGeneration.next(); detailJob?.cancel()
        detailJob = viewModelScope.launch {
            _detail.value = LoadState.Loading
            val result = try { LoadState.Ready(api.hotel(id)) } catch (e: CancellationException) { throw e } catch (e: Exception) { LoadState.Error(e.message ?: "تعذر تحميل الفندق") }
            if (detailGeneration.accepts(token)) _detail.value = result
        }
    }
    fun retryDetail() { hotelId?.let(::openHotel) }
    fun chooseRoom(room: HotelRoom) {
        if (_pending.value != null) { resumePending(); _message.value = "راجع طلب الحجز السابق قبل بدء حجز آخر"; return }
        quoteRequest = Triple(_filters.value, hotelId ?: return, room.id)
        retryQuote()
    }
    fun retryQuote() {
        if (_busy.value || _pending.value != null) return
        if (quoteRequest == null) {
            val q = (_quote.value as? LoadState.Ready)?.value?.let { JSONObject(it.json) } ?: return
            quoteRequest = Triple(HotelSearch(checkIn = q.getString("check_in"), checkOut = q.getString("check_out"), adults = q.getInt("adults"), rooms = q.getInt("rooms_count")), q.optString("hotel_id"), q.optString("room_id"))
        }
        val (search, hotel, room) = quoteRequest!!
        _page.value = HotelPage.Booking
        val token = quoteGeneration.next(); quoteJob?.cancel()
        quoteJob = viewModelScope.launch {
            _quote.value = LoadState.Loading
            val result = try { LoadState.Ready(api.hotelQuote(search, hotel, room)) } catch (e: CancellationException) { throw e } catch (e: Exception) { LoadState.Error(e.message ?: "تعذر التحقق من السعر والتوفر") }
            if (quoteGeneration.accepts(token)) _quote.value = result
        }
    }
    fun submit(name: String, phone: String, email: String, notes: String) {
        if (_busy.value) return
        val quote = (_quote.value as? LoadState.Ready)?.value ?: return
        val body = _pending.value ?: run {
            if (name.trim().length !in 2..180 || phone.filter(Char::isDigit).length < 7 || phone.length > 80 || notes.length > 2000 || (email.isNotBlank() && !Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+").matches(email.trim()))) { _message.value = "راجع اسم الضيف ورقم الهاتف والبريد الإلكتروني"; return }
            quote.bookingBody(name, phone, email, notes, UUID.randomUUID().toString()).toString()
        }
        _busy.value = true
        // Persist the same request key before sending so recovery cannot create a second booking.
        val saved = preferences.edit().putString("pending", JSONObject().put("body", JSONObject(body)).put("quote", JSONObject(quote.json)).toString()).commit()
        if (!saved) { _busy.value = false; _message.value = "تعذر حفظ طلب الحجز على الجهاز. لم يُرسل الطلب."; return }
        _pending.value = body
        viewModelScope.launch {
            try {
                val receipt = api.bookHotel(body)
                val rows = (listOf(receipt) + _history.value).distinctBy { it.code }.take(50)
                val json = JSONArray().apply { rows.forEach { put(JSONObject(it.json)) } }
                val persisted = preferences.edit().putString("receipts", json.toString()).remove("pending").commit()
                _history.value = rows; _receipt.value = receipt; _pending.value = null; _page.value = HotelPage.Receipt
                if (!persisted) _message.value = "تم الحجز؛ انسخ رقم الحجز لأن حفظه على الجهاز تعذر"
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (e is ApiException && e.status in listOf(400, 404, 409, 422)) {
                    preferences.edit().remove("pending").commit(); _pending.value = null
                    _quote.value = LoadState.Error(e.message ?: "راجع عرض السعر والتوفر")
                    _message.value = e.message
                } else _message.value = "لم يتأكد وصول نتيجة الحجز. اضغط «التحقق من الطلب» لإعادة التحقق دون إنشاء طلب جديد."
            } finally { _busy.value = false }
        }
    }
    fun resumePending() { if (_pending.value != null) _page.value = HotelPage.Booking }
    fun history() { _page.value = HotelPage.History }
    fun viewReceipt(receipt: HotelReceipt) { _receipt.value = receipt; _page.value = HotelPage.Receipt }
    fun back() {
        if (_busy.value) { _message.value = "انتظر اكتمال إرسال الحجز"; return }
        when (_page.value) {
            HotelPage.Booking -> { quoteGeneration.next(); quoteJob?.cancel(); _page.value = if (hotelId == null) HotelPage.Search else HotelPage.Detail }
            HotelPage.Detail -> { detailGeneration.next(); detailJob?.cancel(); _page.value = HotelPage.Search }
            else -> _page.value = HotelPage.Search
        }
    }
}

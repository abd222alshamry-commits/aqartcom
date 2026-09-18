package com.aqartkom.nativeapp

import android.content.ContentResolver
import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.aqartkom.nativeapp.data.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val api = (application as AqartkomApplication).api
    private var selectedId: String? = null
    private var detailJob: Job? = null
    private var searchJob: Job? = null
    private val detailGeneration = RequestGeneration()
    private val searchGeneration = RequestGeneration()
    private val homeGeneration = RequestGeneration()
    private val accountGeneration = RequestGeneration()
    private val sessionGeneration = RequestGeneration()
    private val knownProperties = mutableMapOf<String, Property>()
    private val _home = MutableStateFlow<LoadState<List<Property>>>(LoadState.Loading)
    val home = _home.asStateFlow()
    private val _comparison = MutableStateFlow<List<Property>>(emptyList())
    val comparison = _comparison.asStateFlow()
    private val _dashboard = MutableStateFlow<LoadState<OwnerDashboard>>(LoadState.Loading)
    val dashboard = _dashboard.asStateFlow()
    private val _favoriteListings = MutableStateFlow<LoadState<List<Property>>>(LoadState.Loading)
    val favoriteListings = _favoriteListings.asStateFlow()
    private val localFavorites = application.getSharedPreferences("aqartkom_local_favorites", 0)

    private val _properties = MutableStateFlow<LoadState<List<Property>>>(LoadState.Loading)
    val properties: StateFlow<LoadState<List<Property>>> = _properties.asStateFlow()
    private val _selected = MutableStateFlow<LoadState<Property>?>(null)
    val selected: StateFlow<LoadState<Property>?> = _selected.asStateFlow()
    private val _user = MutableStateFlow<User?>(null)
    val user: StateFlow<User?> = _user.asStateFlow()
    private val _favorites = MutableStateFlow<Set<String>>(localFavorites.getStringSet("ids", emptySet()).orEmpty())
    val favorites: StateFlow<Set<String>> = _favorites.asStateFlow()
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private var uploadSession: UploadSession? = null
    private val _uploadProgress = MutableStateFlow(UploadProgress())
    val uploadProgress = _uploadProgress.asStateFlow()
    private val _filters = MutableStateFlow(SearchFilters())
    val filters: StateFlow<SearchFilters> = _filters.asStateFlow()

    init { refreshHome(); restoreSession() }

    fun refreshHome() {
        val token = homeGeneration.next()
        viewModelScope.launch {
            _home.value = LoadState.Loading
            val result = try { LoadState.Ready(api.properties()) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { LoadState.Error(e.message ?: "تعذر تحميل العقارات") }
            if (homeGeneration.accepts(token)) {
                _home.value = result
                (result as? LoadState.Ready)?.value?.forEach { knownProperties[it.id] = it }
            }
        }
    }

    fun toggleCompare(property: Property) {
        val rows = _comparison.value
        if (rows.any { it.id == property.id }) _comparison.value = rows.filterNot { it.id == property.id }
        else if (rows.size < 3) _comparison.value = rows + property
        else _message.value = "يمكن مقارنة 3 عقارات. أزل أحدها لإضافة عقار آخر."
    }

    fun loadDashboard() {
        val userId = _user.value?.id ?: return
        val generation = accountGeneration.current()
        viewModelScope.launch {
            _dashboard.value = LoadState.Loading
            val result = try { LoadState.Ready(api.ownerDashboard()) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { LoadState.Error(e.message ?: "تعذر تحميل إعلاناتك") }
            if (userId == _user.value?.id && accountGeneration.accepts(generation)) _dashboard.value = result
        }
    }

    fun loadFavoriteListings() {
        val ids = _favorites.value.toSet()
        val generation = accountGeneration.current()
        viewModelScope.launch {
            _favoriteListings.value = LoadState.Loading
            val found = mutableListOf<Property>()
            var missing = 0
            for (id in ids) {
                if (!accountGeneration.accepts(generation)) return@launch
                try { found += knownProperties[id] ?: api.property(id).also { knownProperties[id] = it } }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { missing++ }
            }
            if (accountGeneration.accepts(generation)) {
                _favoriteListings.value = if (found.isEmpty() && missing > 0) LoadState.Error("تعذر تحميل العقارات المحفوظة. تحقق من الاتصال وأعد المحاولة.") else LoadState.Ready(found.filter { it.id in _favorites.value })
                if (missing > 0 && found.isNotEmpty()) _message.value = "تعذر تحميل بعض العقارات المحفوظة؛ قد تكون غير متاحة أو تعذر الاتصال."
            }
        }
    }

    fun refresh(filters: SearchFilters = _filters.value) {
        _filters.value = filters
        val token = searchGeneration.next()
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            _properties.value = LoadState.Loading
            val result = try { LoadState.Ready(api.properties(filters)) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { LoadState.Error(e.message ?: "تعذر تحميل العقارات") }
            if (searchGeneration.accepts(token)) {
                _properties.value = result
                (result as? LoadState.Ready)?.value?.forEach { knownProperties[it.id] = it }
            }
        }
    }

    fun openProperty(id: String) {
        if (selectedId == id && detailJob?.isActive == true) return
        val token = detailGeneration.next()
        detailJob?.cancel()
        selectedId = id
        _selected.value = LoadState.Loading
        detailJob = viewModelScope.launch {
            val result = try { LoadState.Ready(api.property(id)) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { LoadState.Error(e.message ?: "تعذر تحميل العقار") }
            if (detailGeneration.accepts(token) && selectedId == id) {
                _selected.value = result
                (result as? LoadState.Ready)?.value?.let { knownProperties[it.id] = it }
            }
        }
    }

    fun openOwnProperty(property: Property) {
        detailGeneration.next()
        detailJob?.cancel()
        selectedId = null
        _selected.value = LoadState.Ready(property.copy(owner = _user.value?.let { Advertiser(it.name, it.phone, it.role) }))
    }

    fun clearSelected() {
        detailGeneration.next()
        detailJob?.cancel()
        detailJob = null
        selectedId = null
        _selected.value = null
    }
    fun retrySelected() { selectedId?.let(::openProperty) }

    private fun restoreSession() { refreshSession() }
    fun refreshSession() = viewModelScope.launch {
        val request = sessionGeneration.next()
        try {
            val refreshed = api.me()
            if (!sessionGeneration.accepts(request)) return@launch
            if (_user.value?.id != refreshed?.id) {
                accountGeneration.next(); _dashboard.value = LoadState.Loading
                _favoriteListings.value = LoadState.Loading
                _favorites.value = localFavorites.getStringSet("ids", emptySet()).orEmpty()
            }
            _user.value = refreshed
            if (refreshed != null) {
                val saved = api.favorites()
                if (sessionGeneration.accepts(request)) _favorites.value = _favorites.value + saved
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { /* Keep last state while offline. */ }
    }

    fun authenticate(register: Boolean, name: String, email: String, phone: String, password: String, done: () -> Unit) {
        sessionGeneration.next()
        viewModelScope.launch {
            _busy.value = true
            try {
                _user.value = if (register) api.register(name, email, phone, password) else api.login(email, password)
                accountGeneration.next()
                _dashboard.value = LoadState.Loading
                _favorites.value = api.favorites()
                _message.value = "مرحبًا ${_user.value?.name}"
                done()
            } catch (e: Exception) { _message.value = e.message ?: "تعذر تسجيل الدخول" }
            finally { _busy.value = false }
        }
    }

    fun logout() = viewModelScope.launch {
        if (_busy.value) { _message.value = "انتظر انتهاء الرفع أولًا"; return@launch }
        sessionGeneration.next()
        runCatching { api.logout() }
        _user.value = null
        accountGeneration.next()
        _dashboard.value = LoadState.Loading
        _favoriteListings.value = LoadState.Loading
        uploadSession = null
        _uploadProgress.value = UploadProgress()
        _favorites.value = localFavorites.getStringSet("ids", emptySet()).orEmpty()
        _message.value = "تم تسجيل الخروج"
    }

    fun toggleFavorite(id: String) {
        if (_user.value == null) { _message.value = "سجّل الدخول أولًا لحفظ العقارات"; return }
        val add = id !in _favorites.value
        viewModelScope.launch {
            try {
                if (!id.startsWith("market-")) api.setFavorite(id, add)
                _favorites.value = if (add) _favorites.value + id else _favorites.value - id
                if (!add) (_favoriteListings.value as? LoadState.Ready)?.let { _favoriteListings.value = LoadState.Ready(it.value.filterNot { p -> p.id == id }) }
                localFavorites.edit().putStringSet("ids", _favorites.value.filter { it.startsWith("market-") }.toSet()).apply()
            } catch (e: Exception) { _message.value = e.message }
        }
    }

    fun createProperty(draft: PropertyDraft, resolver: ContentResolver, media: List<Uri>, done: (String) -> Unit) {
        if (_user.value == null) { _message.value = "سجّل الدخول لإضافة إعلان"; return }
        if (_busy.value) return
        _busy.value = true
        viewModelScope.launch {
            try {
                val session = uploadSession ?: run {
                    api.validateMedia(resolver, media)
                    val property = api.createProperty(draft)
                    UploadSession(property.id, media.map(Uri::toString)).also { uploadSession = it }
                }
                _uploadProgress.value = UploadProgress(true, session.uploaded, session.total)
                for (item in session.remaining) {
                    api.uploadMediaItem(session.propertyId, resolver, Uri.parse(item))
                    session.acknowledge(item)
                    _uploadProgress.value = UploadProgress(true, session.uploaded, session.total)
                }
                _message.value = "تم حفظ الإعلان وجميع المرفقات بنجاح"
                uploadSession = null
                _uploadProgress.value = UploadProgress()
                refresh()
                refreshHome()
                done(session.propertyId)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                val error = e.message ?: "تعذر رفع الوسائط"
                _uploadProgress.value = _uploadProgress.value.copy(error = error)
                _message.value = if (uploadSession != null) "الإعلان محفوظ. أعد محاولة رفع المرفقات المتبقية من صفحة الإضافة." else error
            }
            finally { _busy.value = false }
        }
    }

    fun showMessage(text: String) { _message.value = text }
    fun finishPartialSubmission(done: () -> Unit) {
        val session = uploadSession ?: return
        if (_busy.value) return
        uploadSession = null
        _uploadProgress.value = UploadProgress()
        _message.value = "تم الاحتفاظ بالإعلان و${session.uploaded} مرفقات؛ لم تُرفع المرفقات المتبقية"
        refresh()
        done()
    }
    fun clearMessage() { _message.value = null }
}

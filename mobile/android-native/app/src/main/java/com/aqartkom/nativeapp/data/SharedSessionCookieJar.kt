package com.aqartkom.nativeapp.data

import android.content.Context
import android.webkit.CookieManager
import kotlinx.coroutines.*
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import kotlin.coroutines.resume

/** WebView and the native API use one cookie store; no credentials in URLs or JS. */
class SharedSessionCookieJar(context: Context, private val origin: HttpUrl) : CookieJar {
    private val manager = CookieManager.getInstance()
    private val preferences = context.getSharedPreferences("aqartkom_session", Context.MODE_PRIVATE)
    private val ready = CompletableDeferred<Unit>()
    init {
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).launch {
            try {
                manager.setAcceptCookie(true)
                if (!preferences.getBoolean("web_cookie_migrated", false)) {
                    val old = preferences.getStringSet("cookies", emptySet()).orEmpty().mapNotNull { Cookie.parse(origin, it) }
                    for (cookie in old) if (cookie.expiresAt > System.currentTimeMillis() && cookie.matches(origin)) setCookie(cookie.toString())
                    manager.flush()
                    preferences.edit().remove("cookies").putBoolean("web_cookie_migrated", true).apply()
                }
                ready.complete(Unit)
            } catch (e: Exception) { ready.completeExceptionally(e) }
        }
    }
    private suspend fun setCookie(value: String) = suspendCancellableCoroutine<Unit> { continuation ->
        manager.setCookie(origin.toString(), value) { accepted ->
            if (continuation.isActive) {
                if (accepted) continuation.resume(Unit)
                else continuation.resumeWith(Result.failure(IllegalStateException("تعذر حفظ جلسة الدخول")))
            }
        }
    }
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (!SiteAccess.trusted(url.toString(), origin.toString())) return
        // OkHttp invokes this on the API IO dispatcher, never the UI thread.
        runBlocking { ready.await(); withContext(Dispatchers.Main) { for (cookie in cookies) setCookie(cookie.toString()); manager.flush() } }
    }
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (!SiteAccess.trusted(url.toString(), origin.toString())) return emptyList()
        runBlocking { ready.await() }
        return manager.getCookie(url.toString()).orEmpty().split(';').mapNotNull { Cookie.parse(url, it.trim()) }
    }
    fun clear() = runBlocking {
        ready.await()
        withContext(Dispatchers.Main) {
            for (pair in manager.getCookie(origin.toString()).orEmpty().split(';')) {
                val name = pair.substringBefore('=').trim()
                if (name.isNotEmpty()) setCookie("$name=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax")
            }
            manager.flush()
        }
    }
    suspend fun awaitReady() { ready.await() }
}

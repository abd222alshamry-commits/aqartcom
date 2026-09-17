package com.aqartkom.nativeapp

import android.app.Application
import org.maplibre.android.MapLibre
import org.maplibre.android.module.http.HttpRequestUtil
import okhttp3.OkHttpClient
import okhttp3.Cache
import java.io.File

class AqartkomApplication : Application() {
    val api by lazy { com.aqartkom.nativeapp.data.AqartkomApi(this) }
    override fun onCreate() {
        super.onCreate()
        MapLibre.getInstance(this)
        HttpRequestUtil.setOkHttpClient(OkHttpClient.Builder()
            .cache(Cache(File(cacheDir, "map-http"), 32L * 1024 * 1024))
            .addInterceptor { chain ->
                chain.proceed(chain.request().newBuilder()
                    .header("User-Agent", "Aqartkom/${BuildConfig.VERSION_NAME} (+${BuildConfig.API_ORIGIN})")
                    .build())
            }.build())
    }
}

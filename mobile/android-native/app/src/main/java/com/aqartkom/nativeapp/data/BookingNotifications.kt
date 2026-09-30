package com.aqartkom.nativeapp.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.*
import com.aqartkom.nativeapp.AqartkomApplication
import com.aqartkom.nativeapp.SiteActivity
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class BookingNotice(val id: String, val title: String, val body: String, val path: String)
object BookingNotifications {
    private const val CHANNEL = "hotel-booking-requests"
    private const val WORK = "hotel-booking-notifications"
    fun enabled(context: Context) = context.getSharedPreferences(WORK, 0).getBoolean("enabled", false)
    fun permitted(context: Context) = (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && NotificationManagerCompat.from(context).areNotificationsEnabled()
    fun enable(context: Context) {
        context.getSharedPreferences(WORK, 0).edit().putBoolean("enabled", true).apply()
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "طلبات الحجوزات", NotificationManager.IMPORTANCE_DEFAULT))
        val request = PeriodicWorkRequestBuilder<BookingNotificationWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }
    fun disable(context: Context) {
        context.getSharedPreferences(WORK, 0).edit().putBoolean("enabled", false).apply()
        WorkManager.getInstance(context).cancelUniqueWork(WORK)
        NotificationManagerCompat.from(context).cancelAll()
    }
    fun notices(json: JSONObject): List<BookingNotice> {
        val rows = json.optJSONArray("data") ?: return emptyList()
        return (0 until rows.length()).mapNotNull { i ->
            val row = rows.optJSONObject(i) ?: return@mapNotNull null
            val path = row.optString("action_url")
            if (row.optBoolean("is_read") || !row.optString("type").startsWith("hotel_booking_") || !Regex("^/(hotel-partner|hotels)\\.html([?#][^\\r\\n]*)?$").matches(path)) null
            else BookingNotice(row.optString("id"), row.optString("title"), row.optString("body"), path)
        }
    }
    fun show(context: Context, json: JSONObject) {
        if (!enabled(context) || !permitted(context)) return
        val user = json.optString("user_id").takeIf { it.matches(Regex("[1-9][0-9]*")) } ?: return
        val prefs = context.getSharedPreferences(WORK, 0)
        val previous = prefs.getString("active_user", null)
        if (previous != user) NotificationManagerCompat.from(context).cancelAll()
        prefs.edit().putString("active_user", user).apply()
        val seen = prefs.getStringSet("seen_$user", emptySet()).orEmpty().toMutableSet()
        val fresh = notices(json).filter { it.id !in seen }
        for (n in fresh.take(5)) {
            val intent = Intent(context, SiteActivity::class.java).putExtra("path", n.path)
            val pending = PendingIntent.getActivity(context, (user+":"+n.id).hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(com.aqartkom.nativeapp.R.drawable.ic_notification)
                .setContentTitle(n.title).setContentText(n.body).setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setAutoCancel(true).setContentIntent(pending).build()
            try { NotificationManagerCompat.from(context).notify((user+":"+n.id).hashCode(), notification); seen.add(n.id) }
            catch (_: SecurityException) { return }
        }
        prefs.edit().putStringSet("seen_$user", seen.sortedByDescending { it.toLongOrNull() ?: 0 }.take(500).toSet()).apply()
    }
}
class BookingNotificationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!BookingNotifications.enabled(applicationContext) || !BookingNotifications.permitted(applicationContext)) return Result.success()
        return try {
            val api = (applicationContext as AqartkomApplication).api
            val json = api.notifications()
            if (api.me()?.id == json.optLong("user_id")) BookingNotifications.show(applicationContext, json)
            Result.success()
        } catch (e: CancellationException) { throw e }
        catch (e: ApiException) { if (e.status == 401) { NotificationManagerCompat.from(applicationContext).cancelAll(); Result.success() } else Result.retry() }
        catch (_: Exception) { Result.retry() }
    }
}

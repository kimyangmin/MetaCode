package me.kimyangmin.metacode.callservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * 통화 중임을 알리는 포그라운드 서비스. 안드로이드는 앱이 뒤로 가면 마이크를 막고 프로세스를 멈출 수 있어서,
 * 통화하는 동안 알림을 띄워 둔 채 이 서비스를 켜 둔다. 알림을 누르면 앱으로 돌아간다.
 */
class CallService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "통화 중"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val notification = buildNotification(title, text)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_NOT_STICKY
  }

  private fun buildNotification(title: String, text: String): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "통화", NotificationManager.IMPORTANCE_LOW)
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
    }
    val content = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_CALL)
      .setContentIntent(content)
      .build()
  }

  companion object {
    const val ACTION_STOP = "me.kimyangmin.metacode.callservice.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "call"
    private const val NOTIFICATION_ID = 7301
  }
}

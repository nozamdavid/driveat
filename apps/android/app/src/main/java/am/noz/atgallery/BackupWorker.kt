package am.noz.atgallery

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.work.*

class BackupWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  override suspend fun doWork(): Result {
    setForeground(foregroundInfo("Scanning MediaStore", 0, 0))
    setProgress(workDataOf(PROGRESS_DETAIL to "Scanning photos"))
    val media = MediaRepository(applicationContext).images()
    val store = NativeBackupStore(applicationContext)
    val pending = media.filterNot { store.isHandled(it.id) }
    if (SessionStore(applicationContext).load() == null) {
      setProgress(workDataOf(PROGRESS_DETAIL to "Sign in to start backup"))
      return Result.failure(workDataOf("error" to "Sign in to start backup"))
    }
    val api = AtProtoApi(applicationContext)
    var uploaded = 0
    var skipped = 0
    return try {
      for ((index, item) in pending.withIndex()) {
        if (isStopped) return Result.retry()
        val prefix = "Photo ${index + 1} of ${pending.size}"
        api.backup(item) { detail ->
          val text = "$prefix · $detail"
          setProgress(workDataOf(PROGRESS_DETAIL to text, "current" to index + 1, "total" to pending.size, "filename" to item.name))
          setForeground(foregroundInfo(text, index + 1, pending.size))
        }.let { outcome ->
          when (outcome) {
            BackupOutcome.Uploaded -> { store.backedUp(item.id); uploaded++ }
            BackupOutcome.AlreadyUploaded -> store.backedUp(item.id)
            is BackupOutcome.Skipped -> { store.skipped(item.id, outcome.reason); skipped++ }
          }
        }
      }
      Result.success(workDataOf("uploaded" to uploaded, "skipped" to skipped, "photoCount" to media.size))
    } catch (error: Throwable) {
      val message = error.message ?: "Native backup failed"
      store.error(message)
      if (error is java.io.IOException) Result.retry() else Result.failure(workDataOf("error" to message))
    }
  }

  private fun foregroundInfo(detail: String, current: Int, total: Int): ForegroundInfo {
    val manager = applicationContext.getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(CHANNEL, "Photo backup", NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "Shows live backup progress"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)

    val progressText = if (total > 0) "${(total - current + 1).coerceIn(0, total)} photos left…" else "Calculating photos left…"
    val stopIntent = PendingIntent.getBroadcast(
      applicationContext,
      NOTIFICATION_ID,
      Intent(applicationContext, StopBackupReceiver::class.java).putExtra(StopBackupReceiver.EXTRA_WORK_ID, id.toString()),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val promote = inputData.getBoolean(PROMOTE_LIVE_UPDATE, false)
    val notification = if (Build.VERSION.SDK_INT >= 36 && promote) {
      liveUpdateNotification(detail, progressText, current, total, stopIntent)
    } else {
      NotificationCompat.Builder(applicationContext, CHANNEL)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("Backup in progress")
        .setContentText(progressText)
        .setSubText(detail)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setProgress(total, current, total <= 0)
        .addAction(0, "Stop backup", stopIntent)
        .build()
    }
    return ForegroundInfo(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
  }

  @androidx.annotation.RequiresApi(36)
  private fun liveUpdateNotification(detail: String, progressText: String, current: Int, total: Int, stopIntent: PendingIntent): Notification {
    val style = Notification.ProgressStyle()
      .setProgress(if (total > 0) current.coerceAtMost(total) else 0)
      .setProgressIndeterminate(total <= 0)
    if (total > 0) {
      style.setProgressSegments(listOf(Notification.ProgressStyle.Segment(total).setColor(Color.rgb(46, 125, 91))))
    }
    val builder = Notification.Builder(applicationContext, CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("Backup in progress")
      .setContentText(progressText)
      .setSubText(detail)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      .addExtras(Bundle().apply { putBoolean("android.requestPromotedOngoing", true) })
      .setStyle(style)
      .addAction(Notification.Action.Builder(null, "Stop backup", stopIntent).build())
    return builder.build()
  }

  companion object {
    const val PROGRESS_DETAIL = "detail"
    const val PROMOTE_LIVE_UPDATE = "promote_live_update"
    private const val CHANNEL = "native-photo-backup"
    private const val NOTIFICATION_ID = 10585
  }
}

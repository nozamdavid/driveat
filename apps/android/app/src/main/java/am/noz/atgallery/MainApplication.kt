package am.noz.atgallery

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.Application
import android.os.Build

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    if (wasLastExitAUserStop()) BackupScheduler.cancelAfterUserStop(this)
  }

  private fun wasLastExitAUserStop(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
    val activityManager = getSystemService(ActivityManager::class.java)
    val exit = activityManager.getHistoricalProcessExitReasons(packageName, 0, 1).firstOrNull() ?: return false
    val preferences = getSharedPreferences("native_backup_state", MODE_PRIVATE)
    val lastHandledExit = preferences.getLong("last_handled_user_stop", 0L)
    return (exit.reason == ApplicationExitInfo.REASON_USER_REQUESTED && exit.timestamp > lastHandledExit)
      .also { shouldCancel ->
        if (shouldCancel) preferences.edit().putLong("last_handled_user_stop", exit.timestamp).apply()
      }
  }
}

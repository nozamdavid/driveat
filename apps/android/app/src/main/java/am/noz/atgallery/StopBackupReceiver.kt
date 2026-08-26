package am.noz.atgallery

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.WorkManager
import java.util.UUID

class StopBackupReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    intent.getStringExtra(EXTRA_WORK_ID)?.let { rawId ->
      runCatching { UUID.fromString(rawId) }.getOrNull()?.let {
        WorkManager.getInstance(context).cancelWorkById(it)
      }
    }
  }

  companion object {
    const val EXTRA_WORK_ID = "work_id"
  }
}

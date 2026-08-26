package am.noz.atgallery

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

object BackupScheduler {
  const val UNIQUE_WORK = "atgallery-native-backup"
  const val BACKUP_TAG = "atgallery-backup-job"
  const val MANUAL_TAG = "atgallery-manual-backup"
  const val PERIODIC_TAG = "atgallery-periodic-backup"
  private const val PERIODIC_WORK = "atgallery-native-periodic-backup"
  fun runNow(context: Context) {
    val request = OneTimeWorkRequestBuilder<BackupWorker>()
      .addTag(BACKUP_TAG)
      .addTag(MANUAL_TAG)
      .setInputData(workDataOf(BackupWorker.PROMOTE_LIVE_UPDATE to true))
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
    WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_WORK, ExistingWorkPolicy.KEEP, request)
  }
  fun schedulePeriodic(context: Context) {
    val request = PeriodicWorkRequestBuilder<BackupWorker>(24, TimeUnit.HOURS)
      .addTag(BACKUP_TAG)
      .addTag(PERIODIC_TAG)
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
  }

  fun cancelAfterUserStop(context: Context) {
    WorkManager.getInstance(context).apply {
      cancelUniqueWork(UNIQUE_WORK)
      cancelUniqueWork(PERIODIC_WORK)
    }
  }


  fun stopRunning(context: Context, workIds: Set<java.util.UUID>) {
    val manager = WorkManager.getInstance(context)
    workIds.forEach(manager::cancelWorkById)
  }
}

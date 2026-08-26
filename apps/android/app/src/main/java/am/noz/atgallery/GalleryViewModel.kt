package am.noz.atgallery

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class GalleryState(
  val media: List<LocalMedia> = emptyList(),
  val mediaStatuses: Map<Long, LocalBackupStatus> = emptyMap(),
  val hideBackedUpAndIncompatible: Boolean = false,
  val permissionGranted: Boolean = false,
  val running: Boolean = false,
  val status: String = "Ready",
  val signedInDid: String? = null,
  val authenticating: Boolean = false,
  val scanningRemote: Boolean = false,
  val scanComplete: Boolean = false,
)

class GalleryViewModel(application: Application) : AndroidViewModel(application) {
  private val repository = MediaRepository(application)
  private val oauth = AtProtoOAuth(application)
  private val mutableState = MutableStateFlow(GalleryState())
  val state: StateFlow<GalleryState> = mutableState.asStateFlow()
  private var activeWorkIds: Set<java.util.UUID> = emptySet()

  init {
    val preferences = application.getSharedPreferences("gallery_preferences", Application.MODE_PRIVATE)
    mutableState.value = mutableState.value.copy(
      signedInDid = SessionStore(application).load()?.did,
      hideBackedUpAndIncompatible = preferences.getBoolean("hide_backed_up_and_incompatible", false),
    )
    viewModelScope.launch {
      WorkManager.getInstance(application).getWorkInfosByTagFlow(BackupScheduler.BACKUP_TAG).collect { work ->
        val active = work.filter {
          it.state == WorkInfo.State.RUNNING ||
            (it.state == WorkInfo.State.ENQUEUED && BackupScheduler.MANUAL_TAG in it.tags)
        }
        activeWorkIds = active.mapTo(mutableSetOf()) { it.id }
        val current = active.firstOrNull { it.state == WorkInfo.State.RUNNING }
          ?: active.firstOrNull { it.state == WorkInfo.State.ENQUEUED }
          ?: work.maxByOrNull { it.generation }
        val running = active.isNotEmpty()
        val status = when (current?.state) {
          WorkInfo.State.SUCCEEDED -> "Backup complete · ${current.outputData.getInt("uploaded", 0)} uploaded · ${current.outputData.getInt("skipped", 0)} skipped"
          WorkInfo.State.FAILED -> current.outputData.getString("error") ?: "Backup failed"
          WorkInfo.State.CANCELLED -> "Backup cancelled"
          else -> current?.progress?.getString(BackupWorker.PROGRESS_DETAIL) ?: if (running) "Preparing backup" else mutableState.value.status
        }
        mutableState.value = mutableState.value.copy(running = running, status = status, mediaStatuses = storedStatuses(mutableState.value.media))
      }
    }
  }

  fun hasMediaPermission(): Boolean {
    val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE
    return ContextCompat.checkSelfPermission(getApplication(), permission) == PackageManager.PERMISSION_GRANTED
  }

  fun refresh() = viewModelScope.launch {
    val granted = hasMediaPermission()
    val media = if (granted) repository.images() else emptyList()
    mutableState.value = mutableState.value.copy(permissionGranted = granted, media = media, mediaStatuses = storedStatuses(media))
    if (granted && mutableState.value.signedInDid != null && !mutableState.value.running) reconcileOnLoad(media)
  }

  fun startBackup() = BackupScheduler.runNow(getApplication())

  fun stopBackup() = BackupScheduler.stopRunning(getApplication(), activeWorkIds)

  fun logout() {
    BackupScheduler.stopRunning(getApplication(), activeWorkIds)
    SessionStore(getApplication()).clear()
    AtProtoApi(getApplication()).clearCache()
    mutableState.value = mutableState.value.copy(
      signedInDid = null,
      status = "Signed out",
      scanningRemote = false,
      scanComplete = false,
    )
  }

  fun setHideBackedUpAndIncompatible(hidden: Boolean) {
    getApplication<Application>().getSharedPreferences("gallery_preferences", Application.MODE_PRIVATE)
      .edit().putBoolean("hide_backed_up_and_incompatible", hidden).apply()
    mutableState.value = mutableState.value.copy(hideBackedUpAndIncompatible = hidden)
  }

  fun beginLogin(handle: String, launch: (String) -> Unit) = viewModelScope.launch {
    mutableState.value = mutableState.value.copy(authenticating = true, status = "Preparing secure login")
    runCatching { oauth.begin(handle.trim()).url }.onSuccess(launch).onFailure { error ->
      mutableState.value = mutableState.value.copy(authenticating = false, status = error.message ?: "Login failed")
    }
  }

  fun finishLogin(callback: android.net.Uri) = viewModelScope.launch {
    mutableState.value = mutableState.value.copy(authenticating = true, status = "Completing secure login")
    runCatching { oauth.finish(callback) }.onSuccess { session ->
      BackupScheduler.schedulePeriodic(getApplication())
      mutableState.value = mutableState.value.copy(authenticating = false, signedInDid = session.did, status = "Signed in")
      refresh()
    }.onFailure { error -> mutableState.value = mutableState.value.copy(authenticating = false, status = error.message ?: "Login failed") }
  }

  private suspend fun reconcileOnLoad(media: List<LocalMedia>) {
    if (mutableState.value.scanningRemote) return
    val store = NativeBackupStore(getApplication())
    mutableState.value = mutableState.value.copy(scanningRemote = true, scanComplete = false, status = "Connecting to your Space…")
    val api = AtProtoApi(getApplication())
    runCatching {
      val remote = api.fetchAllRemoteFingerprints { count ->
        mutableState.value = mutableState.value.copy(status = "Scanning Library records ($count found)…")
      }
      var backed = 0
      var skipped = 0
      var pending = 0
      for (item in media) {
        val local = api.fingerprintsForMedia(item)
        if (local.any(remote::contains)) {
          store.backedUp(item.id)
          backed++
        } else if (MediaCompatibility.uploadMime(item.name, item.mimeType) == null) {
          store.skipped(item.id, "Unsupported format")
          skipped++
        } else if (item.size > 25L * 1024 * 1024) {
          store.skipped(item.id, "Original exceeds 25 MiB")
          skipped++
        } else {
          pending++
        }
      }
      mutableState.value = mutableState.value.copy(
        scanningRemote = false,
        scanComplete = true,
        mediaStatuses = storedStatuses(media),
        status = "Library checked · $backed backed up · $pending pending" + (if (skipped > 0) " · $skipped skipped" else "")
      )
    }.onFailure { error ->
      val signedIn = SessionStore(getApplication()).load()?.did
      mutableState.value = mutableState.value.copy(
        scanningRemote = false,
        scanComplete = false,
        signedInDid = signedIn,
        status = error.message ?: "Library check failed"
      )
    }
  }


  private fun storedStatuses(media: List<LocalMedia>): Map<Long, LocalBackupStatus> {
    val store = NativeBackupStore(getApplication())
    return media.mapNotNull { item -> store.status(item.id)?.let { item.id to it } }.toMap()
  }
}

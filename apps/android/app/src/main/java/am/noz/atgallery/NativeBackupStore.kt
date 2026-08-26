package am.noz.atgallery

import android.content.Context

enum class LocalBackupStatus { INCOMPATIBLE, SKIPPED, BACKED_UP }

class NativeBackupStore(context: Context) {
  private val prefs = context.getSharedPreferences("native_backup_state", Context.MODE_PRIVATE)
  private val backed: MutableSet<String> get() = prefs.getStringSet("backed", emptySet())!!.toMutableSet()
  private val skipped: MutableSet<String> get() = prefs.getStringSet("skipped", emptySet())!!.toMutableSet()
  fun isHandled(id: Long) = id.toString() in backed || id.toString() in skipped
  fun status(id: Long): LocalBackupStatus? = when (id.toString()) {
    in backed -> LocalBackupStatus.BACKED_UP
    in skipped -> if (prefs.getString("skip_reason_$id", null)?.isIncompatibleReason() == true) LocalBackupStatus.INCOMPATIBLE else LocalBackupStatus.SKIPPED
    else -> null
  }
  fun backedUp(id: Long) { prefs.edit().putStringSet("backed", backed.apply { add(id.toString()) }).putLong("last_success", System.currentTimeMillis()).remove("last_error").apply() }
  fun skipped(id: Long, reason: String) { prefs.edit().putStringSet("skipped", skipped.apply { add(id.toString()) }).putString("skip_reason_$id", reason).putString("last_skip", reason).apply() }
  fun error(message: String) { prefs.edit().putString("last_error", message).putLong("last_attempt", System.currentTimeMillis()).apply() }
  fun backedCount() = backed.size
  fun skippedCount() = skipped.size
}

private fun String.isIncompatibleReason() =
  startsWith("Unsupported image format") || contains("could not decode this image format", ignoreCase = true)

package am.noz.atgallery

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.time.Instant

class AtProtoApi(private val context: Context) {
  private val oauth = AtProtoOAuth(context)
  private val sessionStore = SessionStore(context)
  private var cachedSpace: String? = null
  private var cachedFingerprints: MutableSet<String>? = null

  suspend fun preflight(media: LocalMedia): PreflightOutcome {
    val session = sessionStore.load() ?: error("Sign in before checking photos")
    val space = cachedSpace ?: personalSpace(session).also { cachedSpace = it }
    val remote = cachedFingerprints ?: remoteFingerprints(session, space).toMutableSet().also { cachedFingerprints = it }
    val local = fingerprints(media.name, media.size, media.width, media.height, media.capturedAtMillis)
    if (local.any(remote::contains)) return PreflightOutcome.AlreadyUploaded
    if (MediaCompatibility.uploadMime(media.name, media.mimeType) == null) {
      return PreflightOutcome.Skipped("Unsupported image format (${media.mimeType ?: media.name.substringAfterLast('.', "unknown")})")
    }
    if (media.size > 25L * 1024 * 1024) return PreflightOutcome.Skipped("Original exceeds 25 MiB")
    return PreflightOutcome.Pending
  }

  suspend fun backup(media: LocalMedia, progress: suspend (String) -> Unit): BackupOutcome {
    val session = sessionStore.load() ?: error("Sign in before backing up")
    val space = cachedSpace ?: personalSpace(session).also { cachedSpace = it }
    progress("Checking whether ${media.name} is already backed up")
    val fingerprints = cachedFingerprints ?: remoteFingerprints(session, space).toMutableSet().also { cachedFingerprints = it }
    val localFingerprints = fingerprints(media.name, media.size, media.width, media.height, media.capturedAtMillis)
    when (val check = preflight(media)) {
      PreflightOutcome.AlreadyUploaded -> return BackupOutcome.AlreadyUploaded
      is PreflightOutcome.Skipped -> return BackupOutcome.Skipped(check.reason)
      PreflightOutcome.Pending -> Unit
    }
    val mime = MediaCompatibility.uploadMime(media.name, media.mimeType)!!

    progress("Reading ${media.name}")
    val original = runCatching { context.contentResolver.openInputStream(media.uri)?.use { it.readBytes() } }.getOrNull()
      ?: return BackupOutcome.Skipped("Android could not read this image")
    progress("Creating preview for ${media.name}")
    val preview = preview(media.uri) ?: return BackupOutcome.Skipped("Android could not decode this image format")
    if (preview.size > 1024 * 1024) return BackupOutcome.Skipped("Generated preview exceeds 1 MiB")
    progress("Uploading ${media.name}")
    val originalBlob = uploadBlob(session, original, mime)
    val previewBlob = uploadBlob(session, preview, "image/webp")
    progress("Writing private media and transfer records")
    val createdAt = Instant.now().toString()
    val mediaValue = JSONObject().put("\$type", AtProtoConfig.LIBRARY_MEDIA).put("formatVersion", 1).put("mediaKind", "image")
      .put("original", originalBlob).put("originalFilename", media.name).put("originalMime", mime).put("originalSize", original.size)
      .put("preview", previewBlob).put("width", media.width).put("height", media.height)
      .put("extractedMetadata", JSONObject().put("captureTime", Instant.ofEpochMilli(media.capturedAtMillis).toString())).put("createdAt", createdAt)
    val transferValue = JSONObject().put("\$type", AtProtoConfig.TRANSFER_EVENT).put("formatVersion", 1).put("operation", "ingest")
      .put("logicalBytes", original.size + preview.size).put("blobOperations", 2).put("itemCount", 1).put("createdAt", createdAt)
    val writes = JSONArray()
      .put(JSONObject().put("\$type", "com.atproto.space.applyWrites#create").put("collection", AtProtoConfig.LIBRARY_MEDIA).put("value", mediaValue))
      .put(JSONObject().put("\$type", "com.atproto.space.applyWrites#create").put("collection", AtProtoConfig.TRANSFER_EVENT).put("value", transferValue))
    postJson(session, "/xrpc/com.atproto.space.applyWrites", JSONObject().put("space", space).put("repo", session.did).put("writes", writes))
    fingerprints += localFingerprints
    return BackupOutcome.Uploaded
  }

  private suspend fun personalSpace(session: OAuthSession): String {
    val url = Uri.parse("${session.resourceServer}/xrpc/com.atproto.space.listSpaces").buildUpon().appendQueryParameter("type", AtProtoConfig.PERSONAL_LIBRARY).appendQueryParameter("did", session.did).appendQueryParameter("limit", "100").build().toString()
    val json = getJson(url)
    val spaces = json.optJSONArray("spaces") ?: JSONArray()
    require(spaces.length() == 1) { if (spaces.length() == 0) "Create the personal Library Space in the web app first" else "Multiple personal Library Spaces found" }
    return spaces.getJSONObject(0).getString("uri")
  }

  private suspend fun remoteFingerprints(session: OAuthSession, space: String): Set<String> {
    val result = mutableSetOf<String>(); var cursor: String? = null
    do {
      val builder = Uri.parse("${session.resourceServer}/xrpc/com.atproto.space.listRecords").buildUpon().appendQueryParameter("space", space).appendQueryParameter("repo", session.did).appendQueryParameter("collection", AtProtoConfig.LIBRARY_MEDIA).appendQueryParameter("limit", "100")
      cursor?.let { builder.appendQueryParameter("cursor", it) }
      val json = getJson(builder.build().toString()); val records = json.optJSONArray("records") ?: JSONArray()
      for (i in 0 until records.length()) records.getJSONObject(i).optJSONObject("value")?.let { value ->
        if (value.has("originalFilename") && value.has("originalSize")) {
          val capture = value.optJSONObject("extractedMetadata")?.optString("captureTime")?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
          result += fingerprints(value.getString("originalFilename"), value.getLong("originalSize"), value.optInt("width"), value.optInt("height"), capture)
        }
      }
      cursor = json.optString("cursor").takeIf(String::isNotBlank)
    } while (cursor != null)
    return result
  }

  private suspend fun uploadBlob(session: OAuthSession, bytes: ByteArray, mime: String): JSONObject {
    val response = oauth.authorized("POST", "${session.resourceServer}/xrpc/com.atproto.repo.uploadBlob", bytes.toRequestBody(mime.toMediaType()), mime)
    return response.use {
      val text = it.body?.string()
      if (!it.isSuccessful) error(errorMessage(text, "Blob upload failed (${it.code})"))
      JSONObject(text ?: error("Empty blob response")).getJSONObject("blob")
    }
  }

  private suspend fun getJson(url: String): JSONObject = oauth.authorized("GET", url).use { response ->
    val text = response.body?.string(); if (!response.isSuccessful) error(errorMessage(text, "Request failed (${response.code})")); JSONObject(text ?: "{}")
  }
  private suspend fun postJson(session: OAuthSession, path: String, json: JSONObject) {
    oauth.authorized("POST", session.resourceServer + path, json.toString().toRequestBody("application/json".toMediaType()), "application/json").use { response -> if (!response.isSuccessful) error(errorMessage(response.body?.string(), "Record write failed (${response.code})")) }
  }

  private fun preview(uri: Uri): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1; while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
    val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
    return ByteArrayOutputStream().use { output -> bitmap.compress(Bitmap.CompressFormat.WEBP_LOSSY, 82, output); bitmap.recycle(); output.toByteArray() }
  }
  private fun fingerprints(name: String, size: Long, width: Int, height: Int, capturedAt: Long?): Set<String> = buildSet {
    add("exact:$name\u0000$size\u0000$width\u0000$height")
    add("nameSize:$name\u0000$size")
    capturedAt?.takeIf { it > 0 }?.let { add("captureSize:${Instant.ofEpochMilli(it)}\u0000$size") }
  }
  private fun errorMessage(body: String?, fallback: String) = runCatching { JSONObject(body ?: "").optString("message").takeIf(String::isNotBlank) }.getOrNull() ?: fallback
}

sealed interface BackupOutcome {
  data object Uploaded : BackupOutcome
  data object AlreadyUploaded : BackupOutcome
  data class Skipped(val reason: String) : BackupOutcome
}

sealed interface PreflightOutcome {
  data object Pending : PreflightOutcome
  data object AlreadyUploaded : PreflightOutcome
  data class Skipped(val reason: String) : PreflightOutcome
}

package am.noz.atgallery

object MediaCompatibility {
  private val mimeByExtension = mapOf("jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "webp" to "image/webp")

  fun uploadMime(filename: String, reportedMime: String?): String? {
    val extension = filename.substringAfterLast('.', "").lowercase()
    val expected = mimeByExtension[extension] ?: return null
    return if (reportedMime == null || reportedMime == "application/octet-stream" || reportedMime.equals(expected, ignoreCase = true)) expected else null
  }
}

package am.noz.atgallery

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class LocalMedia(val id: Long, val uri: Uri, val name: String, val mimeType: String?, val size: Long, val width: Int, val height: Int, val capturedAtMillis: Long)

class MediaRepository(private val context: Context) {
  suspend fun images(): List<LocalMedia> = withContext(Dispatchers.IO) {
    val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
    val projection = arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.MIME_TYPE, MediaStore.Images.Media.SIZE, MediaStore.Images.Media.WIDTH, MediaStore.Images.Media.HEIGHT, MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_ADDED)
    context.contentResolver.query(collection, projection, null, null, "${MediaStore.Images.Media.DATE_TAKEN} DESC, ${MediaStore.Images.Media.DATE_ADDED} DESC")?.use { cursor ->
      val id = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
      val name = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
      val mime = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE)
      val size = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
      val width = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)
      val height = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT)
      val taken = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
      val added = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
      buildList {
        while (cursor.moveToNext()) {
          val mediaId = cursor.getLong(id)
          add(LocalMedia(mediaId, ContentUris.withAppendedId(collection, mediaId), cursor.getString(name) ?: "image-$mediaId", cursor.getString(mime), cursor.getLong(size), cursor.getInt(width), cursor.getInt(height), cursor.getLong(taken).takeIf { it > 0 } ?: cursor.getLong(added) * 1000))
        }
      }
    } ?: emptyList()
  }
}

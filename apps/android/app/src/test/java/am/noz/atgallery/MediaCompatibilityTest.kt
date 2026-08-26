package am.noz.atgallery

import org.junit.Assert.*
import org.junit.Test

class MediaCompatibilityTest {
  @Test fun rejectsRawImages() {
    assertNull(MediaCompatibility.uploadMime("photo.dng", "image/x-adobe-dng"))
    assertNull(MediaCompatibility.uploadMime("photo.cr3", "image/x-canon-cr3"))
    assertNull(MediaCompatibility.uploadMime("photo.nef", "image/x-nikon-nef"))
  }

  @Test fun acceptsSupportedImagesCaseInsensitively() {
    assertEquals("image/jpeg", MediaCompatibility.uploadMime("PHOTO.JPG", "image/jpeg"))
    assertEquals("image/png", MediaCompatibility.uploadMime("capture.png", null))
    assertEquals("image/webp", MediaCompatibility.uploadMime("preview.webp", "application/octet-stream"))
  }

  @Test fun rejectsMismatchedMimeTypes() {
    assertNull(MediaCompatibility.uploadMime("raw.jpg", "image/x-adobe-dng"))
  }
}

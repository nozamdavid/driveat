package am.noz.atgallery

object AtProtoConfig {
  const val PDS = "https://spaces-alpha.host.bsky.network"
  const val CLIENT_ID = "https://atgallery.noz.am/android-oauth-client-metadata.json"
  const val REDIRECT_URI = "am.noz.atgallery:/oauth/callback"
  const val PREFIX = "am.noz.atgallery.alpha"
  const val LIBRARY_MEDIA = "$PREFIX.libraryMedia"
  const val TRANSFER_EVENT = "$PREFIX.transferEvent"
  const val PERSONAL_LIBRARY = "$PREFIX.personalLibrary"

  val scope: String by lazy {
    val public = listOf("publishedAlbum", "albumSnapshot", "publishedMedia", "publishedMembership").map { "repo:$PREFIX.$it" }
    val blob = "blob?" + listOf("image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "video/mp4").joinToString("&") { "accept=${it.replace("/", "%2F")}" }
    val collections = listOf(LIBRARY_MEDIA, "$PREFIX.libraryAlbum", "$PREFIX.libraryMembership", "$PREFIX.publicationJob", TRANSFER_EVENT)
    val space = buildString {
      append("space:$PERSONAL_LIBRARY?")
      append(collections.joinToString("&") { "collection=$it" })
      append("&action=read_self&action=create&action=update&action=delete")
      append("&manage=create&manage=update&manage=delete")
    }
    (listOf("atproto") + public + blob + space).joinToString(" ")
  }
}

package am.noz.atgallery

object AtProtoConfig {
  const val PDS = "https://spaces-alpha.host.bsky.network"
  const val CLIENT_ID = "https://atstorage.noz.am/android-oauth-client-metadata.json"
  const val REDIRECT_URI = "am.noz.atstorage:/oauth/callback"
  const val PREFIX = "am.noz.atgallery.alpha"
  const val LIBRARY_MEDIA = "$PREFIX.libraryMedia"
  const val LIBRARY_INDEX = "$PREFIX.libraryIndex"
  const val TRANSFER_EVENT = "$PREFIX.transferEvent"
  const val PERSONAL_LIBRARY = "$PREFIX.personalLibrary"

  val scope: String by lazy {
    val public = listOf("repo:am.noz.atgallery.account") + listOf("publishedAlbum", "albumSnapshot", "publishedMedia", "publishedMembership").map { "repo:$PREFIX.$it" }
    val blob = "blob?" + listOf("image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "video/mp4", "application/json").joinToString("&") { "accept=${it.replace("/", "%2F")}" }
    val collections = listOf(LIBRARY_MEDIA, "$PREFIX.libraryAlbum", "$PREFIX.libraryMembership", LIBRARY_INDEX, "$PREFIX.publicationJob", TRANSFER_EVENT)
    val space = buildString {
      append("space:$PERSONAL_LIBRARY?")
      append(collections.joinToString("&") { "collection=$it" })
      append("&action=read&action=read_self&action=create&action=update&action=delete")
      append("&manage=create&manage=update&manage=delete")
    }
    (listOf("atproto") + public + blob + space).joinToString(" ")
  }
}

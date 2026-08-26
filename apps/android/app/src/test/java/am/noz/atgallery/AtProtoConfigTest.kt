package am.noz.atgallery

import org.junit.Assert.assertEquals
import org.junit.Test

class AtProtoConfigTest {
  @Test fun oauthScopeMatchesPublishedClientMetadata() {
    assertEquals(
      "atproto repo:am.noz.atgallery.account repo:am.noz.atgallery.alpha.publishedAlbum repo:am.noz.atgallery.alpha.albumSnapshot repo:am.noz.atgallery.alpha.publishedMedia repo:am.noz.atgallery.alpha.publishedMembership blob?accept=image%2Fjpeg&accept=image%2Fpng&accept=image%2Fwebp&accept=image%2Fgif&accept=image%2Favif&accept=video%2Fmp4 space:am.noz.atgallery.alpha.personalLibrary?collection=am.noz.atgallery.alpha.libraryMedia&collection=am.noz.atgallery.alpha.libraryAlbum&collection=am.noz.atgallery.alpha.libraryMembership&collection=am.noz.atgallery.alpha.publicationJob&collection=am.noz.atgallery.alpha.transferEvent&action=read&action=read_self&action=create&action=update&action=delete&manage=create&manage=update&manage=delete",
      AtProtoConfig.scope,
    )
  }
}

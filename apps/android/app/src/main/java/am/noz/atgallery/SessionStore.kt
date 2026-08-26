package am.noz.atgallery

import android.content.Context

data class OAuthSession(val did: String, val accessToken: String, val refreshToken: String?, val tokenEndpoint: String, val resourceServer: String, val issuer: String)

class SessionStore(context: Context) {
  private val prefs = context.getSharedPreferences("native_oauth_session", Context.MODE_PRIVATE)
  fun load(): OAuthSession? {
    val did = prefs.getString("did", null) ?: return null
    return OAuthSession(did, prefs.getString("access", null) ?: return null, prefs.getString("refresh", null), prefs.getString("token_endpoint", null) ?: return null, prefs.getString("resource_server", null) ?: AtProtoConfig.PDS, prefs.getString("issuer", null) ?: return null)
  }
  fun save(session: OAuthSession) = prefs.edit().putString("did", session.did).putString("access", session.accessToken).putString("refresh", session.refreshToken).putString("token_endpoint", session.tokenEndpoint).putString("resource_server", session.resourceServer).putString("issuer", session.issuer).apply()
  fun clear() = prefs.edit().clear().apply()
}

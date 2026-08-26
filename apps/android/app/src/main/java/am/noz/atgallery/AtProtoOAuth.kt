package am.noz.atgallery

import android.content.Context
import android.net.Uri
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

data class AuthorizationLaunch(val url: String)

class AtProtoOAuth(private val context: Context) {
  private val http = OkHttpClient.Builder().followRedirects(false).build()
  private val signer = DpopSigner()
  private val sessions = SessionStore(context)
  private val pending = context.getSharedPreferences("native_oauth_pending", Context.MODE_PRIVATE)

  suspend fun begin(input: String): AuthorizationLaunch = withContext(Dispatchers.IO) {
    val trimmed = input.trim()
    val isUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    val pdsUrl = if (isUrl) trimmed.trimEnd('/') else AtProtoConfig.PDS

    val resource = jsonGet("$pdsUrl/.well-known/oauth-protected-resource")
    val issuer = resource.getJSONArray("authorization_servers").getString(0)
    val metadata = jsonGet("$issuer/.well-known/oauth-authorization-server")
    val verifier = random(48)
    val state = random(32)
    val challenge = b64(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
    val parEndpoint = metadata.getString("pushed_authorization_request_endpoint")
    val formBuilder = FormBody.Builder()
      .add("client_id", AtProtoConfig.CLIENT_ID).add("response_type", "code")
      .add("redirect_uri", AtProtoConfig.REDIRECT_URI).add("scope", AtProtoConfig.scope)
      .add("state", state).add("code_challenge", challenge).add("code_challenge_method", "S256")
    if (!isUrl && trimmed.isNotBlank()) {
      formBuilder.add("login_hint", trimmed)
    }
    val form = formBuilder.build()
    val par = dpopRequest(parEndpoint, "POST", form, null)
    val parJson = JSONObject(par.body?.string() ?: error("Empty PAR response"))
    if (!par.isSuccessful) error(listOf(parJson.optString("error"), parJson.optString("error_description"), parJson.optString("message")).filter(String::isNotBlank).joinToString(": ").ifBlank { "Authorization request failed (${par.code})" })
    pending.edit().putString("state", state).putString("verifier", verifier).putString("issuer", issuer)
      .putString("token_endpoint", metadata.getString("token_endpoint")).putString("resource", pdsUrl).apply()
    val url = Uri.parse(metadata.getString("authorization_endpoint")).buildUpon()
      .appendQueryParameter("client_id", AtProtoConfig.CLIENT_ID)
      .appendQueryParameter("request_uri", parJson.getString("request_uri")).build().toString()
    AuthorizationLaunch(url)
  }

  suspend fun finish(callback: Uri): OAuthSession = withContext(Dispatchers.IO) {
    callback.getQueryParameter("error")?.let { error(callback.getQueryParameter("error_description") ?: it) }
    val expectedState = pending.getString("state", null) ?: error("No pending login")
    require(callback.getQueryParameter("state") == expectedState) { "OAuth state mismatch" }
    val issuer = pending.getString("issuer", null) ?: error("Missing issuer")
    callback.getQueryParameter("iss")?.let { require(it == issuer) { "OAuth issuer mismatch" } }
    val tokenEndpoint = pending.getString("token_endpoint", null) ?: error("Missing token endpoint")
    val form = FormBody.Builder().add("grant_type", "authorization_code")
      .add("code", callback.getQueryParameter("code") ?: error("Missing authorization code"))
      .add("redirect_uri", AtProtoConfig.REDIRECT_URI).add("client_id", AtProtoConfig.CLIENT_ID)
      .add("code_verifier", pending.getString("verifier", null) ?: error("Missing PKCE verifier")).build()
    val response = dpopRequest(tokenEndpoint, "POST", form, null)
    val body = JSONObject(response.body?.string() ?: error("Empty token response"))
    if (!response.isSuccessful) error(body.optString("message", body.optString("error", "Token exchange failed")))
    val session = OAuthSession(body.getString("sub"), body.getString("access_token"), body.optString("refresh_token").takeIf(String::isNotBlank), tokenEndpoint, pending.getString("resource", AtProtoConfig.PDS)!!, issuer)
    sessions.save(session); pending.edit().clear().apply(); session
  }

  suspend fun authorized(method: String, url: String, body: RequestBody? = null, contentType: String? = null): Response = withContext(Dispatchers.IO) {
    var session = sessions.load() ?: error("Sign in first")
    var response = resourceRequest(session, method, url, body, contentType)
    if (response.code == 401 && session.refreshToken != null) {
      response.close()
      session = try {
        refresh(session)
      } catch (t: Throwable) {
        sessions.clear()
        throw t
      }
      response = resourceRequest(session, method, url, body, contentType)
      if (response.code == 401) {
        sessions.clear()
        error("Session authorization expired, please sign in again")
      }
    }
    response
  }

  private fun resourceRequest(session: OAuthSession, method: String, url: String, body: RequestBody?, contentType: String?): Response {
    fun execute(nonce: String?) = http.newCall(Request.Builder().url(url).method(method, body).header("Authorization", "DPoP ${session.accessToken}").header("DPoP", signer.proof(method, url, nonce, session.accessToken)).apply { contentType?.let { header("Content-Type", it) } }.build()).execute()
    var response = execute(null)
    val nonce = response.header("DPoP-Nonce")
    if (nonce != null && (response.code == 400 || response.code == 401)) { response.close(); response = execute(nonce) }
    return response
  }

  private fun refresh(old: OAuthSession): OAuthSession {
    val form = FormBody.Builder().add("grant_type", "refresh_token").add("refresh_token", old.refreshToken!!).add("client_id", AtProtoConfig.CLIENT_ID).build()
    val response = dpopRequest(old.tokenEndpoint, "POST", form, null)
    val json = JSONObject(response.body?.string() ?: error("Empty refresh response"))
    if (!response.isSuccessful) {
      sessions.clear()
      error(json.optString("message", "Session refresh failed"))
    }
    return old.copy(did = json.getString("sub"), accessToken = json.getString("access_token"), refreshToken = json.optString("refresh_token").takeIf(String::isNotBlank) ?: old.refreshToken).also(sessions::save)
  }

  private fun dpopRequest(url: String, method: String, body: RequestBody?, accessToken: String?): Response {
    fun execute(nonce: String?) = http.newCall(Request.Builder().url(url).method(method, body).header("DPoP", signer.proof(method, url, nonce, accessToken)).build()).execute()
    var response = execute(null)
    val nonce = response.header("DPoP-Nonce")
    if (nonce != null && (response.code == 400 || response.code == 401)) { response.close(); response = execute(nonce) }
    return response
  }

  private fun jsonGet(url: String): JSONObject = http.newCall(Request.Builder().url(url).build()).execute().use { response ->
    if (!response.isSuccessful) error("Metadata request failed (${response.code})")
    JSONObject(response.body?.string() ?: error("Empty metadata response"))
  }
  private fun random(bytes: Int) = b64(ByteArray(bytes).also(SecureRandom()::nextBytes))
  private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}

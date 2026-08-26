package am.noz.atgallery

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.time.Instant
import java.util.UUID

class DpopSigner {
  private val alias = "atgallery-dpop-v1"
  private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private val publicKey: ECPublicKey
    get() {
      if (!keyStore.containsAlias(alias)) {
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
          initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
        }.generateKeyPair()
      }
      return keyStore.getCertificate(alias).publicKey as ECPublicKey
    }

  fun proof(method: String, url: String, nonce: String? = null, accessToken: String? = null): String {
    val jwk = JSONObject().put("kty", "EC").put("crv", "P-256").put("x", coordinate(publicKey.w.affineX)).put("y", coordinate(publicKey.w.affineY))
    val header = JSONObject().put("typ", "dpop+jwt").put("alg", "ES256").put("jwk", jwk)
    val payload = JSONObject().put("jti", UUID.randomUUID().toString()).put("htm", method.uppercase()).put("htu", url.substringBefore('#')).put("iat", Instant.now().epochSecond)
    nonce?.let { payload.put("nonce", it) }
    accessToken?.let { payload.put("ath", b64(MessageDigest.getInstance("SHA-256").digest(it.toByteArray()))) }
    val signingInput = "${b64(header.toString().toByteArray())}.${b64(payload.toString().toByteArray())}"
    val signature = Signature.getInstance("SHA256withECDSA").run {
      initSign(keyStore.getKey(alias, null) as java.security.PrivateKey)
      update(signingInput.toByteArray())
      sign()
    }
    return "$signingInput.${b64(derToJose(signature))}"
  }

  private fun coordinate(value: BigInteger): String = b64(value.toByteArray().let { bytes -> when { bytes.size == 32 -> bytes; bytes.size > 32 -> bytes.copyOfRange(bytes.size - 32, bytes.size); else -> ByteArray(32 - bytes.size) + bytes } })
  private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  private fun derToJose(der: ByteArray): ByteArray {
    var p = 2
    if ((der[1].toInt() and 0x80) != 0) p += der[1].toInt() and 0x7f
    p++
    val rLen = der[p++].toInt() and 0xff
    val r = der.copyOfRange(p, p + rLen); p += rLen + 1
    val sLen = der[p++].toInt() and 0xff
    val s = der.copyOfRange(p, p + sLen)
    fun fixed(v: ByteArray) = if (v.size > 32) v.copyOfRange(v.size - 32, v.size) else ByteArray(32 - v.size) + v
    return fixed(r) + fixed(s)
  }
}

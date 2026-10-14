package cl.lumastay.huesped.core.data

import android.content.Context
import androidx.core.content.edit

data class FirebaseSession(
    val idToken: String,
    val refreshToken: String,
    val uid: String,
    val expiresAt: Long,
)

class SessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("lumastay_firebase_session_v2", Context.MODE_PRIVATE)

    fun read(): FirebaseSession? {
        val idToken = preferences.getString("idToken", null) ?: return null
        val refreshToken = preferences.getString("refreshToken", "").orEmpty()
        val uid = preferences.getString("uid", null) ?: return null
        return FirebaseSession(
            idToken = idToken,
            refreshToken = refreshToken,
            uid = uid,
            expiresAt = preferences.getLong("expiresAt", 0L),
        )
    }

    fun write(session: FirebaseSession) {
        preferences.edit {
            putString("idToken", session.idToken)
            putString("refreshToken", session.refreshToken)
            putString("uid", session.uid)
            putLong("expiresAt", session.expiresAt)
        }
    }

    fun clear() = preferences.edit { clear() }
}

package cl.lumastay.huesped.core.data

import android.content.Context
import androidx.core.content.edit
import cl.lumastay.huesped.core.model.Reservation
import org.json.JSONArray
import org.json.JSONObject

data class WebpayAttempt(
    val reservationId: String,
    val token: String,
    val requestId: String,
    val ownerUid: String,
    val createdAt: Long,
    val payUrl: String = "",
)

class ReservationStore(context: Context) {
    private val preferences = context.getSharedPreferences("lumastay_reservations_v2", Context.MODE_PRIVATE)

    fun load(): List<Reservation> {
        val raw = preferences.getString("items", "[]").orEmpty()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) add(array.getJSONObject(index).toReservation())
            }
        }.getOrDefault(emptyList())
    }

    fun save(items: List<Reservation>) {
        val array = JSONArray()
        items.forEach { array.put(it.toJson()) }
        preferences.edit { putString("items", array.toString()) }
    }

    // Una vuelta aprobada desde Webpay puede tardar en aparecer en el gestor.
    // Conservamos el bloqueo entre reinicios para no iniciar un segundo cobro.
    fun loadPendingPayments(): Set<String> = preferences.getStringSet("pending_payments", emptySet())?.toSet().orEmpty()

    fun savePendingPayments(ids: Set<String>) {
        preferences.edit(commit = true) { putStringSet("pending_payments", ids.toSet()) }
    }

    private fun paymentAttempts(): JSONObject = runCatching {
        JSONObject(preferences.getString("webpay_attempts", "{}").orEmpty())
    }.getOrDefault(JSONObject())

    fun loadPaymentAttempt(reservationId: String): WebpayAttempt? {
        val item = paymentAttempts().optJSONObject(reservationId) ?: return null
        val token = item.optString("token")
        if (!token.matches(Regex("[A-Za-z0-9]{20,100}"))) return null
        return WebpayAttempt(reservationId, token, item.optString("requestId"),
            item.optString("ownerUid"), item.optLong("createdAt"), item.optString("payUrl"))
    }

    fun savePaymentAttempt(attempt: WebpayAttempt) {
        val all = paymentAttempts().put(attempt.reservationId, JSONObject()
            .put("token", attempt.token)
            .put("requestId", attempt.requestId)
            .put("ownerUid", attempt.ownerUid)
            .put("createdAt", attempt.createdAt)
            .put("payUrl", attempt.payUrl))
        preferences.edit(commit = true) { putString("webpay_attempts", all.toString()) }
    }

    fun clearPaymentAttempt(reservationId: String) {
        val all = paymentAttempts()
        all.remove(reservationId)
        preferences.edit(commit = true) { putString("webpay_attempts", all.toString()) }
    }

    fun clearPaymentAttempts() {
        preferences.edit(commit = true) { remove("webpay_attempts") }
    }

    private fun Reservation.toJson() = JSONObject()
        .put("id", id)
        .put("propertyId", propertyId)
        .put("propertyName", propertyName)
        .put("propertyPlace", propertyPlace)
        .put("propertyImage", propertyImage)
        .put("guestName", guestName)
        .put("documentId", documentId)
        .put("email", email)
        .put("phone", phone)
        .put("checkIn", checkIn)
        .put("checkOut", checkOut)
        .put("guests", guests)
        .put("nights", nights)
        .put("nightlyPrice", nightlyPrice)
        .put("total", total)
        .put("paymentStatus", paymentStatus)
        .put("accessPin", accessPin)
        .put("createdAt", createdAt)
        .put("status", status)
        .put("verified", verified)
        .put("emailVerified", emailVerified)
        .put("syncError", syncError)
        .put("verificationEmailSent", verificationEmailSent)
        .put("verificationEmailError", verificationEmailError)
        .put("confirmationEmailSent", confirmationEmailSent)
        .put("confirmationEmailError", confirmationEmailError)
        .put("biometricStatus", biometricStatus)
        .put("biometricEnrolledAt", biometricEnrolledAt)
        .put("biometricExpiresAt", biometricExpiresAt)
        .put("accessQr", accessQr)
        .put("accessQrImage", accessQrImage)
        .put("accessQrExpiresAt", accessQrExpiresAt)
        .put("dahuaQrStatus", dahuaQrStatus)

    private fun JSONObject.toReservation() = Reservation(
        id = optString("id"),
        propertyId = optInt("propertyId"),
        propertyName = optString("propertyName"),
        propertyPlace = optString("propertyPlace"),
        propertyImage = optString("propertyImage"),
        guestName = optString("guestName"),
        documentId = optString("documentId"),
        email = optString("email"),
        phone = optString("phone"),
        checkIn = optString("checkIn"),
        checkOut = optString("checkOut"),
        guests = optInt("guests", 1),
        nights = optInt("nights", 1),
        nightlyPrice = optInt("nightlyPrice"),
        total = optInt("total"),
        paymentStatus = optString("paymentStatus", "no-realizado-demo"),
        accessPin = optString("accessPin"),
        createdAt = optString("createdAt"),
        status = optString("status", "pendiente-verificacion"),
        verified = optBoolean("verified", false),
        emailVerified = optBoolean("emailVerified", false),
        syncError = optString("syncError"),
        verificationEmailSent = optBoolean("verificationEmailSent", false),
        verificationEmailError = optString("verificationEmailError"),
        confirmationEmailSent = optBoolean("confirmationEmailSent", false),
        confirmationEmailError = optString("confirmationEmailError"),
        biometricStatus = optString("biometricStatus", "sin-registrar"),
        biometricEnrolledAt = optString("biometricEnrolledAt"),
        biometricExpiresAt = optString("biometricExpiresAt"),
        accessQr = optString("accessQr"),
        accessQrImage = optString("accessQrImage"),
        accessQrExpiresAt = optString("accessQrExpiresAt"),
        dahuaQrStatus = optString("dahuaQrStatus"),
    )
}

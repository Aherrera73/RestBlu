package cl.lumastay.huesped.core.data

import android.content.Context
import android.util.Base64
import cl.lumastay.huesped.BuildConfig
import cl.lumastay.huesped.core.model.AiAnswer
import cl.lumastay.huesped.core.model.AiMessage
import cl.lumastay.huesped.core.model.BiometricEnrollmentResult
import cl.lumastay.huesped.core.model.CustomerAccount
import cl.lumastay.huesped.core.model.CustomerProfile
import cl.lumastay.huesped.core.model.GalleryImage
import cl.lumastay.huesped.core.model.LumaProperty
import cl.lumastay.huesped.core.model.Reservation
import cl.lumastay.huesped.core.model.ReservationStatus
import cl.lumastay.huesped.core.model.SearchCriteria
import cl.lumastay.huesped.core.model.UnavailableRange
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

data class WebpayCheckout(val token: String, val payUrl: String)
enum class WebpayPaymentState { APPROVED, PENDING, REJECTED }

class FirebaseRestClient(context: Context) {
    private val sessionStore = SessionStore(context)
    private val projectId = BuildConfig.FIREBASE_PROJECT_ID
    private val apiKey = BuildConfig.FIREBASE_API_KEY
    private val firestore = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents"

    suspend fun loadProperties(): List<LumaProperty> = withContext(Dispatchers.IO) {
        val response = request("$firestore/public_properties?pageSize=100&key=${encode(apiKey)}")
        response.requireSuccess("No fue posible consultar el catálogo en la nube.")
        val documents = JSONObject(response.body).optJSONArray("documents") ?: JSONArray()
        buildList {
            for (index in 0 until documents.length()) {
                val fields = documents.getJSONObject(index).optJSONObject("fields") ?: continue
                add(fields.toProperty())
            }
        }.sortedBy { it.name }
    }

    suspend fun createReservation(reservation: Reservation) = withContext(Dispatchers.IO) {
        val session = ensureSession()
        val fields = linkedMapOf<String, Any?>(
            "id" to reservation.id,
            "guestName" to reservation.guestName,
            "documentId" to reservation.documentId,
            "email" to reservation.email,
            "phone" to reservation.phone,
            "propertyId" to reservation.propertyId,
            "propertyName" to reservation.propertyName,
            "propertyPlace" to reservation.propertyPlace,
            "checkIn" to reservation.checkIn,
            "checkOut" to reservation.checkOut,
            "guests" to reservation.guests,
            "nights" to reservation.nights,
            "nightlyPrice" to reservation.nightlyPrice,
            "total" to reservation.total,
            "accessPin" to reservation.accessPin,
            "syncStatus" to "pending",
            "source" to "android-app",
            "schemaVersion" to 3,
            "createdAt" to reservation.createdAt,
            "ownerUid" to session.uid,
        )
        val body = JSONObject().put("fields", firestoreFields(fields)).toString()
        val url = "$firestore/reservation_intake?documentId=${encode(reservation.id)}&key=${encode(apiKey)}"
        val response = request(url, method = "POST", body = body, bearer = session.idToken)
        if (response.code != HttpURLConnection.HTTP_CONFLICT) {
            response.requireSuccess("No fue posible guardar la reserva en línea.")
        }
    }

    suspend fun getReservationStatus(reservationId: String): ReservationStatus? =
        withContext(Dispatchers.IO) {
            val session = ensureSession()
            val url = "$firestore/reservation_status/${encode(reservationId)}?key=${encode(apiKey)}"
            val response = request(url, bearer = session.idToken)
            if (response.code == HttpURLConnection.HTTP_NOT_FOUND) return@withContext null
            if (response.code == HttpURLConnection.HTTP_FORBIDDEN) {
                throw LumaNetworkException("Esta reserva no está disponible con la sesión actual. Ingresa con la cuenta que hizo la reserva.")
            }
            response.requireSuccess("No fue posible consultar el estado de la reserva.")
            val fields = JSONObject(response.body).optJSONObject("fields") ?: JSONObject()
            ReservationStatus(
                status = fields.value("status") as? String ?: "pendiente-verificacion",
                verified = fields.value("verified") as? Boolean ?: false,
                emailVerified = fields.value("emailVerified") as? Boolean ?: false,
                paymentStatus = (fields.value("paymentStatus") as? String).orEmpty().ifBlank { "pendiente-demo" },
                pdfBase64 = fields.value("pdfBase64") as? String ?: "",
                pdfFileName = fields.value("pdfFileName") as? String ?: "",
                error = fields.value("error") as? String ?: "",
                verificationEmailSent = (fields.value("verificationEmailSentAt") as? String).orEmpty().isNotBlank(),
                verificationEmailError = (fields.value("verificationEmailError") as? String).orEmpty(),
                confirmationEmailSent = (fields.value("confirmationEmailSentAt") as? String).orEmpty().isNotBlank(),
                confirmationEmailError = (fields.value("confirmationEmailError") as? String).orEmpty(),
                biometricStatus = (fields.value("biometricStatus") as? String).orEmpty().ifBlank { "sin-registrar" },
                biometricEnrolledAt = (fields.value("biometricEnrolledAt") as? String).orEmpty(),
                biometricExpiresAt = (fields.value("biometricExpiresAt") as? String).orEmpty(),
                accessQr = (fields.value("accessQr") as? String).orEmpty(),
                accessQrImage = (fields.value("accessQrImage") as? String).orEmpty()
                    .substringAfter("base64,", ""),
                accessQrExpiresAt = (fields.value("accessQrExpiresAt") as? String).orEmpty(),
                dahuaQrStatus = (fields.value("dahuaQrStatus") as? String).orEmpty(),
            )
        }

    // ---------- Pago con Webpay ----------

    // Crea la transacción en el servicio de pagos y devuelve el enlace que abre
    // el formulario de Webpay en el navegador. Al terminar, Webpay vuelve a la
    // app por restblu://webpay.
    suspend fun createWebpayPayment(reservationId: String, amount: Int): WebpayCheckout = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("reservationId", reservationId)
            .put("amount", amount)
            .put("returnTo", "restblu://webpay")
            .toString()
        val response = request("${BuildConfig.PAYMENTS_API}/webpay/create", method = "POST", body = body)
        val data = runCatching { JSONObject(response.body) }.getOrDefault(JSONObject())
        val token = data.optString("token")
        if (response.code !in 200..299 || data.optString("payUrl").isBlank() ||
            !token.matches(Regex("[A-Za-z0-9]{20,100}"))) {
            throw LumaNetworkException(data.optString("error").ifBlank { "Transbank no pudo iniciar el pago. Inténtalo nuevamente." })
        }
        WebpayCheckout(token, data.optString("payUrl"))
    }

    suspend fun getWebpayPaymentState(reservationId: String, token: String): WebpayPaymentState = withContext(Dispatchers.IO) {
        val body = JSONObject().put("reservationId", reservationId).put("token", token).toString()
        val response = request("${BuildConfig.PAYMENTS_API}/webpay/status", method = "POST", body = body)
        response.requireSuccess("No fue posible consultar el pago en Webpay. No inicies otro cobro.")
        when (JSONObject(response.body).optString("state")) {
            "approved" -> WebpayPaymentState.APPROVED
            "rejected" -> WebpayPaymentState.REJECTED
            else -> WebpayPaymentState.PENDING
        }
    }

    // Entrega al gestor el token del pago aprobado; el gestor lo verifica con
    // Transbank antes de confirmar la reserva.
    suspend fun submitWebpayPayment(reservationId: String, webpayToken: String, requestId: String) = withContext(Dispatchers.IO) {
        val id = createBridgeRequest("reservation_payment_requests", mapOf(
            "reservationId" to reservationId,
            "webpayToken" to webpayToken,
        ), requestId)
        awaitBridgeRequest("reservation_payment_requests", id)
    }

    // La huella permanece en Android. El gestor sólo recibe una firma creada
    // con la clave de este teléfono después del diálogo biométrico del sistema.
    suspend fun openDoorWithPhone(
        reservationId: String, requestId: String, signedAt: String,
        publicKey: String, signature: String,
    ) = withContext(Dispatchers.IO) {
        val session = ensureSession()
        val fields = mapOf(
            "reservationId" to reservationId,
            "ownerUid" to session.uid,
            "syncStatus" to "pending",
            "createdAt" to Instant.now().toString(),
            "signedAt" to signedAt,
            "publicKey" to publicKey,
            "signature" to signature,
        )
        val response = request(
            "$firestore/phone_access_requests?documentId=${encode(requestId)}&key=${encode(apiKey)}",
            method = "POST",
            body = JSONObject().put("fields", firestoreFields(fields)).toString(),
            bearer = session.idToken,
        )
        response.requireSuccess("No fue posible enviar la apertura. Comprueba tu conexión y tu reserva.")
        awaitBridgeRequest("phone_access_requests", requestId, intervalMs = 1_000)
    }

    // Apertura de un toque: la autorización es la sesión de la cuenta dueña
    // de la reserva; el gestor vuelve a comprobar pago, fechas y terminal.
    suspend fun openDoorNow(reservationId: String) = withContext(Dispatchers.IO) {
        val requestId = createBridgeRequest("tap_access_requests", mapOf(
            "reservationId" to reservationId,
        ))
        awaitBridgeRequest("tap_access_requests", requestId, intervalMs = 500)
    }

    // ---------- Cuenta RestBlu ----------

    fun currentAccount(): CustomerAccount? = sessionStore.read()?.idToken?.let(::accountFromToken)

    // Crea la cuenta y guarda su perfil con el RUT. Si el RUT ya pertenece a
    // otra cuenta, la cuenta recién creada se elimina.
    suspend fun register(email: String, password: String, profile: CustomerProfile): CustomerAccount = withContext(Dispatchers.IO) {
        val data = identity("accounts:signUp", JSONObject()
            .put("email", email.trim().lowercase())
            .put("password", password)
            .put("returnSecureToken", true))
        val session = storeTokens(data.optString("idToken"), data.optString("refreshToken"), data.optString("localId"), data.optLong("expiresIn", 3600L))
        try {
            saveProfileBlocking(profile, "")
        } catch (error: Exception) {
            runCatching { identity("accounts:delete", JSONObject().put("idToken", session.idToken)) }
            sessionStore.clear()
            throw error
        }
        runCatching { createBridgeRequest("account_verification_requests", mapOf("action" to "send", "code" to "")) }
        accountFromToken(session.idToken) ?: throw LumaNetworkException("No fue posible crear la cuenta.")
    }

    suspend fun login(email: String, password: String): CustomerAccount = withContext(Dispatchers.IO) {
        val data = identity("accounts:signInWithPassword", JSONObject()
            .put("email", email.trim().lowercase())
            .put("password", password)
            .put("returnSecureToken", true))
        val session = storeTokens(data.optString("idToken"), data.optString("refreshToken"), data.optString("localId"), data.optLong("expiresIn", 3600L))
        accountFromToken(session.idToken) ?: throw LumaNetworkException("No fue posible iniciar sesión.")
    }

    // Canjea el ID token de Google por la sesión de Firebase.
    suspend fun signInWithGoogle(googleIdToken: String): CustomerAccount = withContext(Dispatchers.IO) {
        val data = identity("accounts:signInWithIdp", JSONObject()
            .put("postBody", "id_token=${encode(googleIdToken)}&providerId=google.com")
            .put("requestUri", "http://localhost")
            .put("returnSecureToken", true)
            .put("returnIdpCredential", true))
        if (data.optBoolean("needConfirmation") || data.optString("idToken").isBlank()) {
            throw LumaNetworkException("Ya existe una cuenta con ese correo. Ingresa con tu contraseña.")
        }
        val session = storeTokens(data.optString("idToken"), data.optString("refreshToken"), data.optString("localId"), data.optLong("expiresIn", 3600L))
        accountFromToken(session.idToken) ?: throw LumaNetworkException("No fue posible ingresar con Google.")
    }

    suspend fun sendVerificationEmail() = withContext(Dispatchers.IO) { sendVerificationEmailBlocking() }

    // Verificación con código de 6 dígitos: el gestor lo envía por correo y,
    // si es correcto, marca la cuenta como verificada en Firebase.
    suspend fun requestVerificationCode(): Boolean = withContext(Dispatchers.IO) {
        val id = createBridgeRequest("account_verification_requests", mapOf("action" to "send", "code" to ""))
        awaitBridgeRequest("account_verification_requests", id).value("verified") as? Boolean ?: false
    }

    suspend fun verifyAccountCode(code: String): CustomerAccount? = withContext(Dispatchers.IO) {
        val id = createBridgeRequest("account_verification_requests", mapOf("action" to "verify", "code" to code))
        awaitBridgeRequest("account_verification_requests", id)
        val cached = sessionStore.read() ?: return@withContext null
        refreshSession(cached)?.idToken?.let(::accountFromToken)
    }

    private fun sendVerificationEmailBlocking() {
        val session = ensureSession()
        identity("accounts:sendOobCode", JSONObject().put("requestType", "VERIFY_EMAIL").put("idToken", session.idToken))
    }

    suspend fun sendPasswordReset(email: String) = withContext(Dispatchers.IO) {
        identity("accounts:sendOobCode", JSONObject().put("requestType", "PASSWORD_RESET").put("email", email.trim().lowercase()))
        Unit
    }

    // Renueva el token para saber si el correo ya se verificó.
    suspend fun refreshAccount(): CustomerAccount? = withContext(Dispatchers.IO) {
        val cached = sessionStore.read() ?: return@withContext null
        refreshSession(cached)?.idToken?.let(::accountFromToken)
    }

    fun logout() = sessionStore.clear()

    // Favoritos: sólo cambia esa lista del perfil.
    suspend fun saveFavorites(favorites: List<Int>) = withContext(Dispatchers.IO) {
        val session = ensureSession()
        val body = JSONObject().put("fields", firestoreFields(mapOf(
            "favorites" to favorites,
            "updatedAt" to Instant.now().toString(),
        ))).toString()
        val response = request(
            "$firestore/customer_profiles/${encode(session.uid)}?updateMask.fieldPaths=favorites&updateMask.fieldPaths=updatedAt&key=${encode(apiKey)}",
            method = "POST",
            body = body,
            bearer = session.idToken,
            methodOverride = "PATCH",
        )
        response.requireSuccess("No fue posible guardar tus favoritos.")
    }

    suspend fun changePassword(newPassword: String) = withContext(Dispatchers.IO) {
        val session = ensureSession()
        val data = identity("accounts:update", JSONObject()
            .put("idToken", session.idToken)
            .put("password", newPassword)
            .put("returnSecureToken", true))
        storeTokens(data.optString("idToken"), data.optString("refreshToken"), data.optString("localId").ifBlank { session.uid }, data.optLong("expiresIn", 3600L))
        Unit
    }

    // true si la cuenta tiene contraseña (las de Google no).
    suspend fun usesPassword(): Boolean = withContext(Dispatchers.IO) {
        val session = ensureSession()
        val data = identity("accounts:lookup", JSONObject().put("idToken", session.idToken))
        val providers = data.optJSONArray("users")?.optJSONObject(0)?.optJSONArray("providerUserInfo") ?: JSONArray()
        (0 until providers.length()).any { providers.getJSONObject(it).optString("providerId") == "password" }
    }

    // Borra el perfil, libera el RUT y elimina la cuenta.
    suspend fun deleteAccount(documentId: String) = withContext(Dispatchers.IO) {
        val session = ensureSession()
        runCatching { request("$firestore/customer_profiles/${encode(session.uid)}?key=${encode(apiKey)}", method = "DELETE", bearer = session.idToken) }
        if (documentId.isNotBlank()) {
            runCatching { request("$firestore/rut_index/${encode(rutKey(documentId))}?key=${encode(apiKey)}", method = "DELETE", bearer = session.idToken) }
        }
        identity("accounts:delete", JSONObject().put("idToken", session.idToken))
        sessionStore.clear()
    }

    suspend fun loadProfile(): CustomerProfile? = withContext(Dispatchers.IO) {
        val session = ensureSession()
        val response = request("$firestore/customer_profiles/${encode(session.uid)}?key=${encode(apiKey)}", bearer = session.idToken)
        if (response.code == HttpURLConnection.HTTP_NOT_FOUND) return@withContext null
        response.requireSuccess("No fue posible cargar tu perfil.")
        val fields = JSONObject(response.body).optJSONObject("fields") ?: JSONObject()
        CustomerProfile(
            name = (fields.value("name") as? String).orEmpty(),
            documentId = (fields.value("documentId") as? String).orEmpty(),
            phone = (fields.value("phone") as? String).orEmpty(),
            birthDate = (fields.value("birthDate") as? String).orEmpty(),
            nationality = (fields.value("nationality") as? String).orEmpty(),
            emergencyContactName = (fields.value("emergencyContactName") as? String).orEmpty(),
            emergencyContactPhone = (fields.value("emergencyContactPhone") as? String).orEmpty(),
            favorites = (fields.value("favorites") as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }.orEmpty(),
        )
    }

    suspend fun saveProfile(profile: CustomerProfile, previousDocumentId: String = "") = withContext(Dispatchers.IO) {
        saveProfileBlocking(profile, previousDocumentId)
    }

    private fun rutKey(documentId: String) = documentId.filter { it.isDigit() || it.equals('k', ignoreCase = true) }.uppercase()

    // Un RUT pertenece a la primera cuenta que lo registra: rut_index/{RUT}
    // sólo lo puede crear esa cuenta (lo exigen las reglas de Firestore).
    private fun claimRut(documentId: String, session: FirebaseSession) {
        val key = rutKey(documentId)
        val created = request(
            "$firestore/rut_index?documentId=${encode(key)}&key=${encode(apiKey)}",
            method = "POST",
            body = JSONObject().put("fields", firestoreFields(mapOf("uid" to session.uid, "createdAt" to Instant.now().toString()))).toString(),
            bearer = session.idToken,
        )
        if (created.code in 200..299) return
        val own = request("$firestore/rut_index/${encode(key)}?key=${encode(apiKey)}", bearer = session.idToken)
        if (own.code in 200..299) return
        throw LumaNetworkException(
            // Sólo un 409 (ya existe) es un RUT tomado; un 403 es un rechazo de las reglas.
            if (created.code == HttpURLConnection.HTTP_CONFLICT) RUT_TAKEN
            else "No fue posible validar el RUT. Inténtalo nuevamente.",
        )
    }

    private fun saveProfileBlocking(profile: CustomerProfile, previousDocumentId: String) {
        val session = ensureSession()
        claimRut(profile.documentId, session)
        val body = JSONObject().put("fields", firestoreFields(mapOf(
            "name" to profile.name.trim(),
            "documentId" to profile.documentId.trim(),
            "phone" to profile.phone.trim(),
            "birthDate" to profile.birthDate.trim(),
            "nationality" to profile.nationality.trim(),
            "emergencyContactName" to profile.emergencyContactName.trim(),
            "emergencyContactPhone" to profile.emergencyContactPhone.trim(),
            "favorites" to profile.favorites,
            "updatedAt" to Instant.now().toString(),
        ))).toString()
        // HttpURLConnection no admite PATCH: las API de Google aceptan esta cabecera.
        val response = request(
            "$firestore/customer_profiles/${encode(session.uid)}?key=${encode(apiKey)}",
            method = "POST",
            body = body,
            bearer = session.idToken,
            methodOverride = "PATCH",
        )
        response.requireSuccess("No fue posible guardar tu perfil.")
        // Al cambiar el RUT se libera el anterior.
        if (previousDocumentId.isNotBlank() && rutKey(previousDocumentId) != rutKey(profile.documentId)) {
            runCatching {
                request("$firestore/rut_index/${encode(rutKey(previousDocumentId))}?key=${encode(apiKey)}", method = "DELETE", bearer = session.idToken)
            }
        }
    }

    // Reservas de la cuenta, desde cualquier dispositivo (reservation_status
    // con el ownerUid de la sesión).
    suspend fun loadMyReservations(): List<Reservation> = withContext(Dispatchers.IO) {
        val session = ensureSession()
        val query = JSONObject().put("structuredQuery", JSONObject()
            .put("from", JSONArray().put(JSONObject().put("collectionId", "reservation_status")))
            .put("where", JSONObject().put("fieldFilter", JSONObject()
                .put("field", JSONObject().put("fieldPath", "ownerUid"))
                .put("op", "EQUAL")
                .put("value", JSONObject().put("stringValue", session.uid))))
            .put("limit", 100))
        val response = request("$firestore:runQuery?key=${encode(apiKey)}", method = "POST", body = query.toString(), bearer = session.idToken)
        response.requireSuccess("No fue posible cargar tus reservas.")
        val rows = JSONArray(response.body)
        buildList {
            for (index in 0 until rows.length()) {
                val fields = rows.getJSONObject(index).optJSONObject("document")?.optJSONObject("fields") ?: continue
                fields.toReservation()?.let(::add)
            }
        }.sortedByDescending { it.createdAt }
    }

    @Suppress("UNCHECKED_CAST")
    private fun JSONObject.toReservation(): Reservation? {
        val booking = value("booking") as? Map<String, Any?> ?: return null
        val id = booking["id"]?.toString().orEmpty()
        if (id.isBlank()) return null
        fun text(key: String) = booking[key]?.toString().orEmpty()
        fun number(key: String) = (booking[key] as? Number)?.toInt() ?: text(key).toIntOrNull() ?: 0
        val paymentStatus = (value("paymentStatus") as? String).orEmpty().ifBlank { "pendiente-demo" }
        val verified = (value("verified") as? Boolean ?: false) && paymentStatus == "aprobado-demo"
        return Reservation(
            id = id,
            propertyId = number("propertyId"),
            propertyName = text("propertyName"),
            propertyPlace = text("propertyPlace"),
            propertyImage = "",
            guestName = text("guestName"),
            documentId = text("documentId"),
            email = text("email"),
            phone = text("phone"),
            checkIn = text("checkIn"),
            checkOut = text("checkOut"),
            guests = number("guests"),
            nights = number("nights"),
            nightlyPrice = number("nightlyPrice"),
            total = number("total"),
            paymentStatus = paymentStatus,
            accessPin = if (verified) text("accessPin") else "",
            createdAt = text("createdAt"),
            status = (value("status") as? String).orEmpty().ifBlank { "pendiente-verificacion" },
            verified = verified,
            emailVerified = value("emailVerified") as? Boolean ?: false,
            confirmationEmailSent = (value("confirmationEmailSentAt") as? String).orEmpty().isNotBlank(),
            confirmationEmailError = (value("confirmationEmailError") as? String).orEmpty(),
            biometricStatus = (value("biometricStatus") as? String).orEmpty().ifBlank { "sin-registrar" },
            biometricEnrolledAt = (value("biometricEnrolledAt") as? String).orEmpty(),
            biometricExpiresAt = (value("biometricExpiresAt") as? String).orEmpty(),
            accessQrImage = if (verified) (value("accessQrImage") as? String).orEmpty().substringAfter("base64,", "") else "",
            accessQrExpiresAt = if (verified) (value("accessQrExpiresAt") as? String).orEmpty() else "",
            dahuaQrStatus = (value("dahuaQrStatus") as? String).orEmpty(),
        )
    }

    private fun identity(path: String, body: JSONObject): JSONObject {
        val response = request(
            "https://identitytoolkit.googleapis.com/v1/$path?key=${encode(apiKey)}",
            method = "POST",
            body = body.toString(),
        )
        val data = runCatching { JSONObject(response.body) }.getOrDefault(JSONObject())
        if (response.code in 200..299) return data
        val code = data.optJSONObject("error")?.optString("message").orEmpty()
        throw LumaNetworkException(authErrorMessage(code))
    }

    private fun authErrorMessage(code: String): String = when {
        code.startsWith("WEAK_PASSWORD") -> "La contraseña debe tener al menos 6 caracteres."
        code == "EMAIL_EXISTS" -> "Ya existe una cuenta con ese correo. Inicia sesión."
        code in setOf("EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS") -> "Correo o contraseña incorrectos."
        code == "INVALID_EMAIL" -> "El correo no es válido."
        code == "USER_DISABLED" -> "Esta cuenta fue deshabilitada."
        code.startsWith("TOO_MANY_ATTEMPTS_TRY_LATER") -> "Demasiados intentos. Espera unos minutos y vuelve a intentarlo."
        code.startsWith("INVALID_IDP_RESPONSE") -> "Google no confirmó la cuenta. Inténtalo nuevamente."
        code.startsWith("CREDENTIAL_TOO_OLD_LOGIN_AGAIN") || code.startsWith("TOKEN_EXPIRED") -> "Por seguridad, cierra sesión y vuelve a ingresar antes de hacer este cambio."
        else -> "No fue posible completar la operación. Inténtalo nuevamente."
    }

    private fun storeTokens(idToken: String, refreshToken: String, uid: String, expiresIn: Long): FirebaseSession {
        if (idToken.isBlank() || uid.isBlank()) throw LumaNetworkException("Firebase no entregó una sesión válida.")
        return FirebaseSession(
            idToken = idToken,
            refreshToken = refreshToken,
            uid = uid,
            expiresAt = System.currentTimeMillis() + expiresIn * 1000,
        ).also(sessionStore::write)
    }

    // Los datos de la cuenta se leen del token (sólo para la interfaz: Firebase
    // y el gestor verifican el token por su cuenta).
    private fun accountFromToken(idToken: String): CustomerAccount? = runCatching {
        val payload = idToken.split(".")[1]
        val json = JSONObject(String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), StandardCharsets.UTF_8))
        val email = json.optString("email")
        if (email.isBlank()) null
        else CustomerAccount(json.optString("user_id"), email, json.optBoolean("email_verified", false))
    }.getOrNull()

    // onPartial recibe el texto que el gestor va escribiendo (partialAnswer)
    // mientras la solicitud sigue pendiente o en proceso.
    suspend fun askPublicAssistant(
        question: String,
        history: List<AiMessage>,
        search: SearchCriteria,
        onPartial: (String) -> Unit = {},
    ): AiAnswer = withContext(Dispatchers.IO) {
        val requestId = createBridgeRequest("public_ai_requests", mapOf(
            "question" to question.trim().take(1_500),
            "history" to history.takeLast(6).map { mapOf(
                "role" to it.role,
                "content" to it.content.take(1_500),
            ) },
            "search" to mapOf(
                "destination" to search.query.take(120),
                "checkIn" to search.checkIn.take(20),
                "checkOut" to search.checkOut.take(20),
                "guests" to search.guests,
            ),
        ))
        var lastPartial = ""
        val result = awaitBridgeRequest("public_ai_requests", requestId, intervalMs = 1_000) { fields ->
            val partial = (fields.value("partialAnswer") as? String).orEmpty()
            if (partial.isNotBlank() && partial != lastPartial) {
                lastPartial = partial
                onPartial(partial)
            }
        }
        val answer = (result.value("answer") as? String).orEmpty()
            .ifBlank { (result.value("partialAnswer") as? String).orEmpty() }
            .ifBlank { throw LumaNetworkException("El servidor de IA no devolvió una respuesta.") }
        AiAnswer(requestId = requestId, answer = answer, suggestions = result.aiSuggestions())
    }

    // Opinión sobre una respuesta de Blu: las reglas sólo permiten al dueño
    // cambiar estos tres campos de una solicitud ya procesada.
    suspend fun sendAiFeedback(requestId: String, positive: Boolean) = withContext(Dispatchers.IO) {
        val session = ensureSession()
        val body = JSONObject().put("fields", firestoreFields(mapOf(
            "feedback" to if (positive) "up" else "down",
            "feedbackPending" to true,
            "feedbackAt" to Instant.now().toString(),
        ))).toString()
        val response = request(
            "$firestore/public_ai_requests/${encode(requestId)}?updateMask.fieldPaths=feedback" +
                "&updateMask.fieldPaths=feedbackPending&updateMask.fieldPaths=feedbackAt&key=${encode(apiKey)}",
            method = "POST",
            body = body,
            bearer = session.idToken,
            methodOverride = "PATCH",
        )
        response.requireSuccess("No fue posible enviar tu opinión.")
    }

    suspend fun enrollBiometrics(
        reservationId: String,
        documentId: String,
        imageBytes: ByteArray,
    ): BiometricEnrollmentResult = withContext(Dispatchers.IO) {
        val configResponse = request("$firestore/public_biometric_config/current?key=${encode(apiKey)}")
        configResponse.requireSuccess("El gestor todavía no publicó la clave biométrica.")
        val config = JSONObject(configResponse.body).optJSONObject("fields") ?: JSONObject()
        val publicKey = (config.value("publicKey") as? String).orEmpty()
        val keyId = (config.value("keyId") as? String).orEmpty()
        if (publicKey.isBlank() || keyId.isBlank()) {
            throw LumaNetworkException("La clave de transporte biométrica no está disponible.")
        }
        val der = Base64.decode(publicKey.replace(Regex("-----[^-]+-----|\\s"), ""), Base64.DEFAULT)
        val rsaKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
        val rawKey = ByteArray(32)
        val iv = ByteArray(12)
        SecureRandom().apply { nextBytes(rawKey); nextBytes(iv) }
        try {
            val aes = Cipher.getInstance("AES/GCM/NoPadding")
            aes.init(Cipher.ENCRYPT_MODE, SecretKeySpec(rawKey, "AES"), GCMParameterSpec(128, iv))
            val ciphertext = aes.doFinal(imageBytes)
            if (ciphertext.size > 600_000) {
                throw LumaNetworkException("La captura es demasiado grande. Repite la foto con mejor encuadre.")
            }
            val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding")
            rsa.init(
                Cipher.ENCRYPT_MODE,
                rsaKey,
                OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT),
            )
            val wrappedKey = rsa.doFinal(rawKey)
            val encryptedImage = Base64.encodeToString(ciphertext, Base64.NO_WRAP)
            if (encryptedImage.length > 700_000) {
                throw LumaNetworkException("La captura es demasiado grande para el envío seguro.")
            }
            val requestId = createBridgeRequest("public_biometric_requests", mapOf(
                "reservationId" to reservationId,
                "documentId" to documentId,
                "consent" to true,
                "dahuaConsent" to true,
                "mimeType" to "image/jpeg",
                "encryptedImage" to encryptedImage,
                "encryptedKey" to Base64.encodeToString(wrappedKey, Base64.NO_WRAP),
                "iv" to Base64.encodeToString(iv, Base64.NO_WRAP),
                "keyId" to keyId,
            ))
            val result = awaitBridgeRequest("public_biometric_requests", requestId)
            val status = (result.value("status") as? String).orEmpty()
            if (status != "activa") {
                throw LumaNetworkException("El gestor no confirmó el registro biométrico.")
            }
            BiometricEnrollmentResult(
                status = status,
                enrolledAt = (result.value("enrolledAt") as? String).orEmpty(),
                expiresAt = (result.value("expiresAt") as? String).orEmpty(),
            )
        } finally {
            rawKey.fill(0)
            imageBytes.fill(0)
        }
    }

    private fun createBridgeRequest(collection: String, input: Map<String, Any?>, fixedId: String? = null): String {
        val session = ensureSession()
        val id = fixedId ?: UUID.randomUUID().toString()
        val fields = input + mapOf(
            "ownerUid" to session.uid,
            "syncStatus" to "pending",
            "createdAt" to Instant.now().toString(),
        )
        val response = request(
            "$firestore/$collection?documentId=${encode(id)}&key=${encode(apiKey)}",
            method = "POST",
            body = JSONObject().put("fields", firestoreFields(fields)).toString(),
            bearer = session.idToken,
        )
        if (response.code != HttpURLConnection.HTTP_CONFLICT || fixedId == null) {
            response.requireSuccess("Firebase no pudo recibir la solicitud. Revisa tu conexión.")
        }
        return id
    }

    // onProgress recibe el documento mientras sigue pendiente o en proceso.
    private suspend fun awaitBridgeRequest(
        collection: String,
        requestId: String,
        intervalMs: Long = 2_500,
        onProgress: (JSONObject) -> Unit = {},
    ): JSONObject {
        val deadline = System.currentTimeMillis() + 120_000
        while (System.currentTimeMillis() < deadline) {
            delay(intervalMs)
            val session = ensureSession()
            val response = request(
                "$firestore/$collection/${encode(requestId)}?key=${encode(apiKey)}",
                bearer = session.idToken,
            )
            response.requireSuccess("No fue posible consultar la respuesta del gestor.")
            val fields = JSONObject(response.body).optJSONObject("fields") ?: JSONObject()
            when (fields.value("syncStatus")) {
                "processed" -> return fields
                "error" -> throw LumaNetworkException(
                    (fields.value("error") as? String).orEmpty().ifBlank { "El gestor no pudo procesar la solicitud." },
                )
                else -> onProgress(fields)
            }
        }
        throw LumaNetworkException("El gestor aún no responde. La solicitud quedó en espera.")
    }

    private fun ensureSession(): FirebaseSession {
        val cached = sessionStore.read()
        if (cached != null && cached.idToken.isNotBlank() && cached.expiresAt > System.currentTimeMillis() + 60_000) {
            return cached
        }
        if (cached != null && cached.refreshToken.isNotBlank()) {
            // Si una cuenta registrada perdió su sesión, jamás se sustituye
            // silenciosamente por una cuenta anónima: perdería acceso a sus reservas.
            refreshSession(cached)?.let { return it }
            if (accountFromToken(cached.idToken) != null) {
                sessionStore.clear()
                throw LumaNetworkException("Tu sesión venció. Ingresa de nuevo con la cuenta que hizo la reserva.")
            }
            sessionStore.clear()
        }
        val response = request(
            "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encode(apiKey)}",
            method = "POST",
            body = JSONObject().put("returnSecureToken", true).toString(),
        )
        response.requireSuccess("No fue posible iniciar una sesión segura para la reserva.")
        val data = JSONObject(response.body)
        return FirebaseSession(
            idToken = data.optString("idToken"),
            refreshToken = data.optString("refreshToken"),
            uid = data.optString("localId"),
            expiresAt = System.currentTimeMillis() + data.optLong("expiresIn", 3600L) * 1000,
        ).also(sessionStore::write)
    }

    private fun refreshSession(cached: FirebaseSession): FirebaseSession? {
        val form = "grant_type=refresh_token&refresh_token=${encode(cached.refreshToken)}"
        val response = request(
            "https://securetoken.googleapis.com/v1/token?key=${encode(apiKey)}",
            method = "POST",
            body = form,
            contentType = "application/x-www-form-urlencoded",
        )
        if (response.code in 400..499) return null
        response.requireSuccess("No fue posible renovar la sesión.")
        val data = JSONObject(response.body)
        return FirebaseSession(
            idToken = data.optString("id_token"),
            refreshToken = data.optString("refresh_token", cached.refreshToken),
            uid = data.optString("user_id", cached.uid),
            expiresAt = System.currentTimeMillis() + data.optLong("expires_in", 3600L) * 1000,
        ).also(sessionStore::write)
    }

    private fun request(
        url: String,
        method: String = "GET",
        body: String? = null,
        bearer: String? = null,
        contentType: String = "application/json",
        methodOverride: String? = null,
    ): HttpResponse {
        val connection = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 25_000
            connection.setRequestProperty("Accept", "application/json")
            if (!bearer.isNullOrBlank()) connection.setRequestProperty("Authorization", "Bearer $bearer")
            if (!methodOverride.isNullOrBlank()) connection.setRequestProperty("X-HTTP-Method-Override", methodOverride)
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", contentType)
                connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            }
            val code = connection.responseCode
            val input = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = input?.use { stream ->
                BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).readText()
            }.orEmpty()
            return HttpResponse(code, text)
        } catch (error: Exception) {
            throw LumaNetworkException(
                "No fue posible conectar con RestBlu. Revisa tu conexión a internet.",
                error,
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun firestoreFields(values: Map<String, Any?>): JSONObject = JSONObject().apply {
        values.forEach { (key, value) -> put(key, firestoreValue(value)) }
    }

    private fun firestoreValue(value: Any?): JSONObject = when (value) {
        null -> JSONObject().put("nullValue", JSONObject.NULL)
        is Boolean -> JSONObject().put("booleanValue", value)
        is Int, is Long -> JSONObject().put("integerValue", value.toString())
        is Number -> JSONObject().put("doubleValue", value.toDouble())
        is String -> JSONObject().put("stringValue", value)
        is List<*> -> JSONObject().put("arrayValue", JSONObject().put(
            "values",
            JSONArray().apply { value.forEach { put(firestoreValue(it)) } },
        ))
        is Map<*, *> -> JSONObject().put("mapValue", JSONObject().put(
            "fields",
            firestoreFields(value.entries.associate { it.key.toString() to it.value }),
        ))
        else -> JSONObject().put("stringValue", value.toString())
    }

    @Suppress("UNCHECKED_CAST")
    private fun JSONObject.toProperty(): LumaProperty {
        val galleryValues = value("gallery") as? List<*> ?: emptyList<Any?>()
        val gallery = galleryValues.mapNotNull { item ->
            val map = item as? Map<String, Any?> ?: return@mapNotNull null
            GalleryImage(map["src"]?.toString().orEmpty(), map["alt"]?.toString().orEmpty())
        }.filter { it.src.isNotBlank() }
        val tags = (value("tags") as? List<*>)?.map { it.toString() }.orEmpty()
        val unavailableRanges = (value("unavailableRanges") as? List<*>)
            ?.mapNotNull { item ->
                val map = item as? Map<String, Any?> ?: return@mapNotNull null
                val checkIn = map["checkIn"]?.toString().orEmpty()
                val checkOut = map["checkOut"]?.toString().orEmpty()
                if (checkIn.isBlank() || checkOut.isBlank()) null else UnavailableRange(checkIn, checkOut)
            }
            .orEmpty()
        return LumaProperty(
            id = value("id") as? Int ?: 0,
            name = value("name") as? String ?: "Alojamiento",
            place = value("place") as? String ?: "Chile",
            type = value("type") as? String ?: "Alojamiento",
            guests = value("guests") as? Int ?: 1,
            beds = value("beds") as? Int ?: 1,
            baths = value("baths") as? Int ?: 1,
            price = value("price") as? String ?: "$0",
            rating = value("rating") as? String ?: "0.0",
            image = value("image") as? String ?: "",
            gallery = gallery,
            tags = tags,
            unavailableRanges = unavailableRanges,
        )
    }

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.toString())

    private data class HttpResponse(val code: Int, val body: String) {
        fun requireSuccess(message: String) {
            if (code in 200..299) return
            if (code == 429) {
                throw LumaNetworkException(
                    "El servicio está temporalmente saturado. Inténtalo nuevamente en unos minutos.",
                )
            }
            val serverMessage = runCatching {
                JSONObject(body).optJSONObject("error")?.optString("message")
            }.getOrNull().orEmpty()
            throw LumaNetworkException(
                if (serverMessage.isBlank()) message else "$message ($serverMessage)",
            )
        }
    }
}

class LumaNetworkException(message: String, cause: Throwable? = null) : Exception(message, cause)

const val RUT_TAKEN = "Este RUT ya está registrado con otra cuenta RestBlu. Ingresa con el correo con que lo registraste."

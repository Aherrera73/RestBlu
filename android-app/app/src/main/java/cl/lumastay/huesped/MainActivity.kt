package cl.lumastay.huesped

import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.activity.viewModels
import cl.lumastay.huesped.features.LumaStayViewModel
import cl.lumastay.huesped.ui.LumaStayRoot
import cl.lumastay.huesped.ui.theme.LumaStayTheme
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.time.Instant
import java.util.UUID

private data class PhoneAccessAttempt(
    val reservationId: String, val ownerUid: String, val requestId: String,
    val signedAt: String, val publicKey: String,
) {
    fun payload() = "RESTBLU_PHONE_ACCESS_V1\n$ownerUid\n$reservationId\n$requestId\n$signedAt"
}

class MainActivity : FragmentActivity() {
    private val viewModel: LumaStayViewModel by viewModels()
    private var pendingPhoneAccess: PhoneAccessAttempt? = null
    private lateinit var biometricPrompt: BiometricPrompt

    private companion object { const val PHONE_KEY_ALIAS = "restblu_phone_access_v1" }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingPhoneAccess = savedInstanceState?.let { state ->
            val id = state.getString("phoneAccessReservationId").orEmpty()
            if (id.isBlank()) null else PhoneAccessAttempt(
                id, state.getString("phoneAccessOwnerUid").orEmpty(),
                state.getString("phoneAccessRequestId").orEmpty(),
                state.getString("phoneAccessSignedAt").orEmpty(),
                state.getString("phoneAccessPublicKey").orEmpty(),
            )
        }
        biometricPrompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val attempt = pendingPhoneAccess ?: return
                    pendingPhoneAccess = null
                    runCatching {
                        val signature = result.cryptoObject?.signature
                            ?: error("Android no entregó la firma protegida por biometría.")
                        signature.update(attempt.payload().toByteArray(Charsets.UTF_8))
                        val signed = Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
                        viewModel.openDoorWithPhone(attempt.reservationId, attempt.requestId,
                            attempt.signedAt, attempt.publicKey, signed)
                    }.onFailure { viewModel.phoneAccessMessage(it.message ?: "No fue posible autorizar la apertura.") }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    pendingPhoneAccess = null
                    if (errorCode != BiometricPrompt.ERROR_USER_CANCELED &&
                        errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON &&
                        errorCode != BiometricPrompt.ERROR_CANCELED) {
                        viewModel.phoneAccessMessage("No se verificó la biometría: $errString")
                    }
                }
            })
        enableEdgeToEdge()
        handleDeepLink(intent)
        setContent {
            LumaStayTheme {
                val state by viewModel.state.collectAsState()
                LumaStayRoot(state = state, viewModel = viewModel,
                    onPhoneUnlock = ::authenticatePhoneAccess)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    override fun onResume() {
        super.onResume()
        // También recupera el pago si el navegador no abrió el enlace de vuelta.
        viewModel.resumePendingPayments()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        pendingPhoneAccess?.let { attempt ->
            outState.putString("phoneAccessReservationId", attempt.reservationId)
            outState.putString("phoneAccessOwnerUid", attempt.ownerUid)
            outState.putString("phoneAccessRequestId", attempt.requestId)
            outState.putString("phoneAccessSignedAt", attempt.signedAt)
            outState.putString("phoneAccessPublicKey", attempt.publicKey)
        }
        super.onSaveInstanceState(outState)
    }

    private fun phoneKey(): KeyPair {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getEntry(PHONE_KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
        if (existing != null) return KeyPair(existing.certificate.publicKey, existing.privateKey)
        val spec = KeyGenParameterSpec.Builder(PHONE_KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            spec.setUserAuthenticationValidityDurationSeconds(-1)
        }
        return KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            .apply { initialize(spec.build()) }.generateKeyPair()
    }

    private fun authenticatePhoneAccess(reservationId: String) {
        val account = viewModel.state.value.account
        val reservation = viewModel.state.value.reservations.firstOrNull { it.id == reservationId }
        if (account?.emailVerified != true || reservation?.verified != true ||
            reservation.dahuaQrStatus != "activo") {
            viewModel.phoneAccessMessage("Primero confirma el pago y espera que el terminal habilite tu reserva.")
            return
        }
        if (BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            != BiometricManager.BIOMETRIC_SUCCESS) {
            viewModel.phoneAccessMessage("Activa una huella o biometría fuerte en este teléfono para abrir la puerta.")
            return
        }
        runCatching {
            val key = phoneKey()
            val attempt = PhoneAccessAttempt(reservationId, account.uid, UUID.randomUUID().toString(),
                Instant.now().toString(), Base64.encodeToString(key.public.encoded, Base64.NO_WRAP))
            val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(key.private) }
            pendingPhoneAccess = attempt
            val prompt = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Abrir puerta con este teléfono")
                .setSubtitle("Confirma tu identidad para la reserva $reservationId")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setNegativeButtonText("Cancelar")
                .build()
            biometricPrompt.authenticate(prompt, BiometricPrompt.CryptoObject(signature))
        }.onFailure {
            pendingPhoneAccess = null
            viewModel.phoneAccessMessage(it.message ?: "No fue posible iniciar la verificación biométrica.")
        }
    }

    // Vuelta desde Webpay: restblu://webpay?pago=...&estado=...&token=...
    private fun handleDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        viewModel.handleWebpayReturn(uri)
        intent.data = null
    }
}

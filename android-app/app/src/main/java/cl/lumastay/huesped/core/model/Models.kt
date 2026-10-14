package cl.lumastay.huesped.core.model

data class GalleryImage(
    val src: String,
    val alt: String,
)

data class UnavailableRange(
    val checkIn: String,
    val checkOut: String,
)

data class LumaProperty(
    val id: Int,
    val name: String,
    val place: String,
    val type: String,
    val guests: Int,
    val beds: Int,
    val baths: Int,
    val price: String,
    val rating: String,
    val image: String,
    val gallery: List<GalleryImage>,
    val tags: List<String>,
    val unavailableRanges: List<UnavailableRange> = emptyList(),
) {
    val allImages: List<GalleryImage>
        get() = listOf(GalleryImage(image, "Imagen principal de $name")) + gallery
}

data class Reservation(
    val id: String,
    val propertyId: Int,
    val propertyName: String,
    val propertyPlace: String,
    val propertyImage: String,
    val guestName: String,
    val documentId: String,
    val email: String,
    val phone: String,
    val checkIn: String,
    val checkOut: String,
    val guests: Int,
    val nights: Int,
    val nightlyPrice: Int,
    val total: Int,
    val paymentStatus: String = "pendiente-demo",
    val accessPin: String,
    val createdAt: String,
    val status: String = "pendiente-verificacion",
    val verified: Boolean = false,
    val emailVerified: Boolean = false,
    val syncError: String = "",
    val verificationEmailSent: Boolean = false,
    val verificationEmailError: String = "",
    val confirmationEmailSent: Boolean = false,
    val confirmationEmailError: String = "",
    val biometricStatus: String = "sin-registrar",
    val biometricEnrolledAt: String = "",
    val biometricExpiresAt: String = "",
    // Código QR que el gestor registró en el Dahua y su imagen PNG en Base64.
    val accessQr: String = "",
    val accessQrImage: String = "",
    val accessQrExpiresAt: String = "",
    val dahuaQrStatus: String = "",
)

data class ReservationStatus(
    val status: String,
    val verified: Boolean,
    val emailVerified: Boolean = false,
    val paymentStatus: String = "pendiente-demo",
    val pdfBase64: String = "",
    val pdfFileName: String = "",
    val error: String = "",
    val verificationEmailSent: Boolean = false,
    val verificationEmailError: String = "",
    val confirmationEmailSent: Boolean = false,
    val confirmationEmailError: String = "",
    val biometricStatus: String = "sin-registrar",
    val biometricEnrolledAt: String = "",
    val biometricExpiresAt: String = "",
    // Código QR que el gestor registró en el Dahua y su imagen PNG en Base64.
    val accessQr: String = "",
    val accessQrImage: String = "",
    val accessQrExpiresAt: String = "",
    val dahuaQrStatus: String = "",
)

// Mensaje del chat con Blu. Las respuestas guardan su solicitud (para la
// opinión 👍/👎) y los alojamientos sugeridos; feedback es "up", "down" o "".
data class AiMessage(
    val role: String,
    val content: String,
    val requestId: String = "",
    val suggestions: List<AiSuggestion> = emptyList(),
    val feedback: String = "",
    val feedbackBusy: Boolean = false,
    val feedbackError: String = "",
)

// Alojamiento que Blu sugiere. Fechas 'YYYY-MM-DD' o vacías; available es
// null cuando el usuario no indicó fechas.
data class AiSuggestion(
    val propertyId: Int,
    val name: String,
    val checkIn: String,
    val checkOut: String,
    val guests: Int,
    val available: Boolean?,
)

data class AiAnswer(
    val requestId: String,
    val answer: String,
    val suggestions: List<AiSuggestion>,
)

data class BiometricEnrollmentResult(
    val status: String,
    val enrolledAt: String,
    val expiresAt: String,
)

data class GuestDraft(
    val name: String,
    val rut: String,
    val email: String,
    val phone: String,
)

data class SearchCriteria(
    val query: String = "",
    val checkIn: String = "",
    val checkOut: String = "",
    val guests: Int = 2,
)

enum class MainSection(val label: String) {
    HOME("Inicio"),
    RESERVATIONS("Reservas"),
    ACCESS("Acceso"),
    EXPLORE("Más"),
    PROFILE("Perfil"),
}

// Cuenta RestBlu (Firebase Authentication). Una sesión anónima no tiene correo.
data class CustomerAccount(
    val uid: String,
    val email: String,
    val emailVerified: Boolean,
)

data class CustomerProfile(
    val name: String = "",
    val documentId: String = "",
    val phone: String = "",
    val birthDate: String = "",
    val nationality: String = "",
    val emergencyContactName: String = "",
    val emergencyContactPhone: String = "",
    val favorites: List<Int> = emptyList(),
)

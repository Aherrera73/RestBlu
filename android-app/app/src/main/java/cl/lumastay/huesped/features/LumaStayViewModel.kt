package cl.lumastay.huesped.features

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cl.lumastay.huesped.BuildConfig
import cl.lumastay.huesped.core.data.FirebaseRestClient
import cl.lumastay.huesped.core.data.ReservationStore
import cl.lumastay.huesped.core.data.WebpayAttempt
import cl.lumastay.huesped.core.data.WebpayPaymentState
import cl.lumastay.huesped.core.data.sampleCatalog
import cl.lumastay.huesped.core.model.AiMessage
import cl.lumastay.huesped.core.model.AiSuggestion
import cl.lumastay.huesped.core.model.CustomerAccount
import cl.lumastay.huesped.core.model.CustomerProfile
import cl.lumastay.huesped.core.model.GuestDraft
import cl.lumastay.huesped.core.model.LumaProperty
import cl.lumastay.huesped.core.model.MainSection
import cl.lumastay.huesped.core.model.Reservation
import cl.lumastay.huesped.core.model.SearchCriteria
import cl.lumastay.huesped.core.util.datesOverlap
import cl.lumastay.huesped.core.util.formatRut
import cl.lumastay.huesped.core.util.isValidRut
import cl.lumastay.huesped.core.util.makeAccessPin
import cl.lumastay.huesped.core.util.makeReservationCode
import cl.lumastay.huesped.core.util.nightCount
import cl.lumastay.huesped.core.util.normalizeSearch
import cl.lumastay.huesped.core.util.priceToNumber
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

data class PdfPayload(val base64: String, val fileName: String)

data class LumaStayUiState(
    val section: MainSection = MainSection.HOME,
    val properties: List<LumaProperty> = emptyList(),
    val search: SearchCriteria = SearchCriteria(),
    val catalogLoading: Boolean = true,
    val catalogNotice: String = "",
    val selectedProperty: LumaProperty? = null,
    val bookingProperty: LumaProperty? = null,
    val paymentReservationId: String = "",
    val reservations: List<Reservation> = emptyList(),
    val reservationsLoading: Boolean = false,
    val activeReservationId: String = "",
    val busyReservationId: String = "",
    val doorAccessBusyId: String = "",
    val pdfs: Map<String, PdfPayload> = emptyMap(),
    val message: String = "",
    val aiOpen: Boolean = false,
    val aiBusy: Boolean = false,
    val aiError: String = "",
    // Texto que Blu va escribiendo mientras la respuesta está en proceso.
    val aiPartial: String = "",
    val aiMessages: List<AiMessage> = listOf(AiMessage(
        "assistant",
        "¡Hola! Soy Blu, el asistente de RestBlu. Puedo ayudarte a comparar alojamientos, revisar fechas y entender cómo reservar. ¿Qué estás buscando?",
    )),
    val biometricReservationId: String = "",
    val biometricBusy: Boolean = false,
    val biometricError: String = "",
    // Cuenta del cliente: reservar exige cuenta verificada y RUT registrado.
    val account: CustomerAccount? = null,
    val profile: CustomerProfile? = null,
    val profileLoaded: Boolean = false,
    val authBusy: Boolean = false,
    val authError: String = "",
    val authInfo: String = "",
    val accountReason: String = "",
    val pendingBookingProperty: LumaProperty? = null,
    val webpayOpenUrl: String = "",
    val webpayPendingReservationId: String = "",
    val pendingPaymentIds: Set<String> = emptySet(),
    val usesPassword: Boolean? = null,
) {
    val favorites: List<Int> get() = profile?.favorites.orEmpty()
    val readyToBook: Boolean get() = account?.emailVerified == true && !profile?.documentId.isNullOrBlank()
}

class LumaStayViewModel(application: Application) : AndroidViewModel(application) {
    private val cloud = FirebaseRestClient(application)
    private val store = ReservationStore(application)
    private val _state = MutableStateFlow(LumaStayUiState(
        reservations = store.load(),
        account = cloud.currentAccount(),
        pendingPaymentIds = store.loadPendingPayments(),
    ))
    val state: StateFlow<LumaStayUiState> = _state.asStateFlow()
    private val paymentWatchers = mutableSetOf<String>()
    private val paymentConfirmations = mutableSetOf<String>()
    private val reservationReadinessWatchers = mutableSetOf<String>()

    init {
        loadCatalog()
        onAccountChanged()
    }

    fun loadCatalog() {
        viewModelScope.launch {
            _state.update { it.copy(catalogLoading = true, catalogNotice = "") }
            runCatching { cloud.loadProperties() }
                .onSuccess { properties ->
                    _state.update {
                        it.copy(
                            properties = properties.ifEmpty { sampleCatalog },
                            catalogLoading = false,
                            catalogNotice = if (properties.isEmpty()) "El catálogo no está disponible en este momento." else "",
                        )
                    }
                }
                .onFailure {
                    _state.update {
                        it.copy(
                            properties = sampleCatalog,
                            catalogLoading = false,
                            catalogNotice = "Sin conexión. Mostramos alojamientos destacados; revisa tu conexión para ver disponibilidad actualizada.",
                        )
                    }
                }
        }
    }

    fun selectSection(section: MainSection) {
        _state.update { it.copy(section = section, selectedProperty = null) }
        if (section == MainSection.RESERVATIONS || section == MainSection.ACCESS) loadMyReservations()
    }

    // ---------- Cuenta ----------

    private fun onAccountChanged() {
        val account = cloud.currentAccount()
        _state.update { it.copy(account = account, authError = "", authInfo = "") }
        if (account?.emailVerified != true) {
            _state.update { it.copy(profile = null, profileLoaded = false) }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(profileLoaded = false) }
            val profile = runCatching { cloud.loadProfile() }.getOrNull()
            _state.update { it.copy(profile = profile, profileLoaded = true) }
            resumePendingBooking()
        }
        loadMyReservations()
        resumePendingPayments()
    }

    private fun showLoginIfSessionLost() {
        if (_state.value.account == null || cloud.currentAccount() != null) return
        _state.update { it.copy(account = null, profile = null, profileLoaded = false,
            reservations = emptyList(), paymentReservationId = "", section = MainSection.PROFILE,
            message = "Tu sesión venció. Ingresa de nuevo con la cuenta que hizo la reserva.") }
    }

    private fun resumePendingBooking() {
        val current = _state.value
        val pending = current.pendingBookingProperty ?: return
        if (!current.readyToBook) return
        _state.update { it.copy(pendingBookingProperty = null, accountReason = "", bookingProperty = pending, section = MainSection.HOME) }
    }

    private fun authAction(block: suspend () -> Unit) {
        if (_state.value.authBusy) return
        viewModelScope.launch {
            _state.update { it.copy(authBusy = true, authError = "", authInfo = "") }
            try {
                block()
            } catch (error: Exception) {
                _state.update { it.copy(authError = error.message ?: "No fue posible continuar.") }
            } finally {
                _state.update { it.copy(authBusy = false) }
            }
        }
    }

    fun register(name: String, rut: String, phone: String, email: String, password: String) {
        val formattedRut = formatRut(rut)
        val problem = when {
            name.trim().length < 2 -> "Ingresa tu nombre completo."
            !isValidRut(formattedRut) -> "Ingresa un RUT chileno válido."
            phone.filter(Char::isDigit).length < 8 -> "Ingresa un teléfono válido."
            password.length < 6 -> "La contraseña debe tener al menos 6 caracteres."
            else -> ""
        }
        if (problem.isNotBlank()) {
            _state.update { it.copy(authError = problem) }
            return
        }
        authAction {
            val profile = CustomerProfile(name.trim(), formattedRut, phone.trim())
            cloud.register(email, password, profile)
            _state.update { it.copy(profile = profile) }
            onAccountChanged()
        }
    }

    fun login(email: String, password: String) = authAction {
        cloud.login(email, password)
        onAccountChanged()
    }

    fun signInWithGoogle(googleIdToken: String) = authAction {
        cloud.signInWithGoogle(googleIdToken)
        onAccountChanged()
    }

    fun reportAuthError(message: String) = _state.update { it.copy(authError = message) }

    fun sendPasswordReset(email: String) {
        if (email.isBlank()) {
            _state.update { it.copy(authError = "Escribe tu correo para enviarte el enlace de recuperación.") }
            return
        }
        authAction {
            cloud.sendPasswordReset(email)
            _state.update { it.copy(authInfo = "Si existe una cuenta con ese correo, te enviamos un enlace para crear una nueva contraseña.") }
        }
    }

    fun resendVerification() = authAction {
        val alreadyVerified = cloud.requestVerificationCode()
        if (alreadyVerified) {
            cloud.refreshAccount()
            onAccountChanged()
        } else {
            _state.update { it.copy(authInfo = "Te enviamos un código nuevo. Revisa también Spam.") }
        }
    }

    fun verifyCode(code: String) {
        if (code.length != 6 || !code.all(Char::isDigit)) {
            _state.update { it.copy(authError = "Escribe los 6 dígitos del código.") }
            return
        }
        authAction {
            val account = cloud.verifyAccountCode(code)
            if (account?.emailVerified == true) onAccountChanged()
            else _state.update { it.copy(authError = "No pudimos confirmar la verificación. Inténtalo nuevamente.") }
        }
    }

    // Favoritos sincronizados con la cuenta.
    fun toggleFavorite(propertyId: Int) {
        val current = _state.value
        val profile = current.profile
        if (current.account?.emailVerified != true || profile == null || profile.documentId.isBlank()) {
            _state.update { it.copy(message = "Inicia sesión para guardar favoritos en tu cuenta.") }
            return
        }
        val next = if (propertyId in profile.favorites) profile.favorites - propertyId else profile.favorites + propertyId
        _state.update { it.copy(profile = profile.copy(favorites = next)) }
        viewModelScope.launch {
            runCatching { cloud.saveFavorites(next) }
                .onFailure { _state.update { it.copy(message = "No fue posible guardar el favorito.") } }
        }
    }

    fun loadSecurityInfo() {
        if (_state.value.usesPassword != null || _state.value.account == null) return
        viewModelScope.launch {
            val uses = runCatching { cloud.usesPassword() }.getOrDefault(false)
            _state.update { it.copy(usesPassword = uses) }
        }
    }

    fun changePassword(password: String) {
        if (password.length < 6) {
            _state.update { it.copy(authError = "La contraseña debe tener al menos 6 caracteres.") }
            return
        }
        authAction {
            cloud.changePassword(password)
            _state.update { it.copy(authInfo = "Contraseña actualizada.") }
        }
    }

    fun deleteAccount() = authAction {
        cloud.deleteAccount(_state.value.profile?.documentId.orEmpty())
        store.save(emptyList())
        _state.update {
            it.copy(
                account = null, profile = null, profileLoaded = false, reservations = emptyList(), pdfs = emptyMap(),
                usesPassword = null, message = "Tu cuenta fue eliminada.",
            )
        }
    }

    fun saveProfileDetails(details: CustomerProfile) {
        val formattedRut = formatRut(details.documentId)
        val problem = when {
            details.name.trim().length < 2 -> "Ingresa tu nombre completo."
            !isValidRut(formattedRut) -> "Ingresa un RUT chileno válido."
            details.phone.filter(Char::isDigit).length < 8 -> "Ingresa un teléfono válido."
            else -> ""
        }
        if (problem.isNotBlank()) {
            _state.update { it.copy(authError = problem) }
            return
        }
        authAction {
            val profile = details.copy(documentId = formattedRut, favorites = _state.value.profile?.favorites.orEmpty())
            cloud.saveProfile(profile, _state.value.profile?.documentId.orEmpty())
            _state.update { it.copy(profile = profile, profileLoaded = true, authInfo = "Datos guardados.") }
            resumePendingBooking()
        }
    }

    fun saveProfile(name: String, rut: String, phone: String) {
        val formattedRut = formatRut(rut)
        val problem = when {
            name.trim().length < 2 -> "Ingresa tu nombre completo."
            !isValidRut(formattedRut) -> "Ingresa un RUT chileno válido."
            phone.filter(Char::isDigit).length < 8 -> "Ingresa un teléfono válido."
            else -> ""
        }
        if (problem.isNotBlank()) {
            _state.update { it.copy(authError = problem) }
            return
        }
        authAction {
            val profile = (_state.value.profile ?: CustomerProfile()).copy(name = name.trim(), documentId = formattedRut, phone = phone.trim())
            cloud.saveProfile(profile, _state.value.profile?.documentId.orEmpty())
            _state.update { it.copy(profile = profile, profileLoaded = true, authInfo = "Datos guardados.") }
            resumePendingBooking()
        }
    }

    fun logout() {
        cloud.logout()
        store.save(emptyList())
        store.savePendingPayments(emptySet())
        store.clearPaymentAttempts()
        _state.update {
            it.copy(
                account = null, profile = null, profileLoaded = false, reservations = emptyList(), pdfs = emptyMap(),
                activeReservationId = "", paymentReservationId = "", pendingPaymentIds = emptySet(),
                section = MainSection.PROFILE, usesPassword = null,
                message = "Sesión cerrada.",
            )
        }
    }

    private fun markPaymentPending(reservationId: String) {
        if (reservationId.isBlank()) return
        val pending = _state.value.pendingPaymentIds + reservationId
        store.savePendingPayments(pending)
        _state.update { it.copy(pendingPaymentIds = pending) }
    }

    private fun clearPaymentPending(reservationId: String) {
        val pending = _state.value.pendingPaymentIds - reservationId
        store.savePendingPayments(pending)
        store.clearPaymentAttempt(reservationId)
        _state.update { it.copy(pendingPaymentIds = pending) }
    }

    private fun paymentAttempt(reservationId: String): WebpayAttempt? =
        store.loadPaymentAttempt(reservationId)?.takeIf { it.ownerUid == _state.value.account?.uid }

    fun canContinueWebpay(reservationId: String): Boolean =
        paymentAttempt(reservationId)?.payUrl?.startsWith("${BuildConfig.PAYMENTS_API}/webpay/go?") == true

    fun resumePendingPayments() {
        _state.value.pendingPaymentIds.forEach(::watchPaymentConfirmation)
        viewModelScope.launch {
            for (id in _state.value.pendingPaymentIds) reconcilePaymentAttempt(id)
            loadMyReservations()
        }
    }

    private suspend fun sendApprovedPayment(attempt: WebpayAttempt) {
        if (!paymentConfirmations.add(attempt.reservationId)) return
        try {
            cloud.submitWebpayPayment(attempt.reservationId, attempt.token, attempt.requestId)
            loadMyReservations()
        } finally {
            paymentConfirmations.remove(attempt.reservationId)
        }
    }

    private suspend fun reconcilePaymentAttempt(reservationId: String) {
        val attempt = paymentAttempt(reservationId) ?: return
        if (reservationId in paymentConfirmations) return
        runCatching { cloud.getWebpayPaymentState(reservationId, attempt.token) }
            .onSuccess { result ->
                when (result) {
                    WebpayPaymentState.APPROVED -> runCatching { sendApprovedPayment(attempt) }
                    WebpayPaymentState.REJECTED -> clearPaymentPending(reservationId)
                    WebpayPaymentState.PENDING -> Unit
                }
            }
    }

    private fun watchPaymentConfirmation(reservationId: String) {
        if (!paymentWatchers.add(reservationId)) return
        viewModelScope.launch {
            try {
                repeat(90) {
                    delay(10_000)
                    if (reservationId !in _state.value.pendingPaymentIds) return@launch
                    reconcilePaymentAttempt(reservationId)
                    loadMyReservations()
                }
            } finally {
                paymentWatchers.remove(reservationId)
            }
        }
    }

    // ---------- Reservas ----------

    fun loadMyReservations() {
        if (_state.value.account?.emailVerified != true || _state.value.reservationsLoading) return
        viewModelScope.launch {
            _state.update { it.copy(reservationsLoading = true) }
            runCatching { cloud.loadMyReservations() }
                .onSuccess { loaded ->
                    val images = _state.value.properties.associate { it.id to it.image }
                    val previous = _state.value.reservations.associateBy { it.id }
                    val remote = loaded.map { item ->
                        item.copy(propertyImage = images[item.propertyId] ?: previous[item.id]?.propertyImage.orEmpty())
                    }
                    val awaiting = _state.value.reservations.filter { local ->
                        local.status == "pendiente-sincronizacion" && remote.none { it.id == local.id }
                    }
                    val merged = (remote + awaiting).sortedByDescending { it.createdAt }
                    store.save(merged)
                    val resolved = merged.filter { (it.verified && it.paymentStatus == "aprobado-demo") ||
                        it.paymentStatus == "reembolso-pendiente" ||
                        (it.status == "expirada" && paymentAttempt(it.id) == null) }.map { it.id }.toSet()
                    val pending = _state.value.pendingPaymentIds - resolved
                    if (pending != _state.value.pendingPaymentIds) {
                        store.savePendingPayments(pending)
                        resolved.forEach(store::clearPaymentAttempt)
                    }
                    _state.update { it.copy(reservations = merged, reservationsLoading = false, pendingPaymentIds = pending) }
                    awaiting.forEach { watchReservationReady(it.id) }
                }
                .onFailure {
                    _state.update { it.copy(reservationsLoading = false) }
                    showLoginIfSessionLost()
                }
        }
    }

    fun setAiOpen(open: Boolean) = _state.update { it.copy(aiOpen = open) }

    fun askAi(questionText: String) {
        val question = questionText.trim().take(1_500)
        if (question.length < 2 || _state.value.aiBusy) return
        val current = _state.value
        val history = current.aiMessages.drop(1).takeLast(6)
        _state.update {
            it.copy(aiBusy = true, aiError = "", aiPartial = "", aiMessages = it.aiMessages + AiMessage("user", question))
        }
        viewModelScope.launch {
            runCatching {
                cloud.askPublicAssistant(question, history, current.search) { partial ->
                    _state.update { it.copy(aiPartial = partial) }
                }
            }
                .onSuccess { result ->
                    val message = AiMessage("assistant", result.answer, result.requestId, result.suggestions)
                    _state.update { it.copy(aiBusy = false, aiPartial = "", aiMessages = it.aiMessages + message) }
                }
                .onFailure { error ->
                    _state.update {
                        it.copy(aiBusy = false, aiPartial = "", aiError = error.message ?: "RestBlu IA no pudo responder.")
                    }
                }
        }
    }

    // Opinión 👍/👎 sobre una respuesta; si falla, se puede volver a intentar.
    fun sendAiFeedback(requestId: String, positive: Boolean) {
        val target = _state.value.aiMessages.firstOrNull { it.requestId == requestId } ?: return
        if (requestId.isBlank() || target.feedback.isNotBlank() || target.feedbackBusy) return
        updateAiMessage(requestId) { it.copy(feedbackBusy = true, feedbackError = "") }
        viewModelScope.launch {
            runCatching { cloud.sendAiFeedback(requestId, positive) }
                .onSuccess { updateAiMessage(requestId) { it.copy(feedbackBusy = false, feedback = if (positive) "up" else "down") } }
                .onFailure {
                    updateAiMessage(requestId) {
                        it.copy(feedbackBusy = false, feedbackError = "No pudimos enviar tu opinión. Inténtalo nuevamente.")
                    }
                }
        }
    }

    private fun updateAiMessage(requestId: String, transform: (AiMessage) -> AiMessage) =
        _state.update { state ->
            state.copy(aiMessages = state.aiMessages.map { if (it.requestId == requestId) transform(it) else it })
        }

    // Botón bajo una respuesta de Blu: con fechas disponibles inicia la
    // reserva con esas fechas; en otro caso abre la ficha del alojamiento.
    fun openAiSuggestion(suggestion: AiSuggestion) {
        val property = _state.value.properties.firstOrNull { it.id == suggestion.propertyId }
        if (property == null) {
            _state.update { it.copy(aiError = "No encontramos ${suggestion.name} en el catálogo actual.") }
            return
        }
        val withDates = suggestion.available == true && suggestion.checkIn.isNotBlank() && suggestion.checkOut.isNotBlank()
        _state.update {
            val search = if (withDates) it.search.copy(
                checkIn = suggestion.checkIn,
                checkOut = suggestion.checkOut,
                guests = if (suggestion.guests > 0) suggestion.guests.coerceIn(1, 20) else it.search.guests,
            ) else it.search
            it.copy(aiOpen = false, aiError = "", search = search)
        }
        showProperty(property)
        if (withDates) startBooking(property)
    }

    fun startBiometricEnrollment(reservation: Reservation) {
        if (!reservation.verified) {
            _state.update { it.copy(message = "Primero completa el pago de esta reserva.") }
            return
        }
        if (reservation.biometricStatus == "activa") {
            _state.update { it.copy(message = "Esta reserva ya tiene su rostro registrado.") }
            return
        }
        _state.update { it.copy(biometricReservationId = reservation.id, biometricError = "", aiOpen = false) }
    }

    fun cancelBiometricEnrollment() = _state.update {
        it.copy(biometricReservationId = "", biometricError = "", biometricBusy = false)
    }

    fun enrollBiometrics(documentId: String, consent: Boolean, imageBytes: ByteArray) {
        val reservation = _state.value.reservations.firstOrNull { it.id == _state.value.biometricReservationId } ?: return
        val formattedRut = formatRut(documentId)
        val error = when {
            !reservation.verified -> "Primero completa el pago de esta reserva."
            !isValidRut(formattedRut) -> "Ingresa un RUT chileno válido."
            formattedRut != formatRut(reservation.documentId) -> "El RUT no corresponde al huésped de esta reserva."
            !consent -> "Debes autorizar el registro facial para esta estadía."
            imageBytes.isEmpty() -> "Captura tu rostro antes de continuar."
            else -> ""
        }
        if (error.isNotBlank()) {
            _state.update { it.copy(biometricError = error) }
            imageBytes.fill(0)
            return
        }
        if (_state.value.biometricBusy) {
            imageBytes.fill(0)
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(biometricBusy = true, biometricError = "") }
            try {
                val result = cloud.enrollBiometrics(reservation.id, formattedRut, imageBytes)
                val updated = _state.value.reservations.map {
                    if (it.id == reservation.id) it.copy(
                        biometricStatus = result.status,
                        biometricEnrolledAt = result.enrolledAt,
                        biometricExpiresAt = result.expiresAt,
                    ) else it
                }
                store.save(updated)
                _state.update {
                    it.copy(
                        reservations = updated,
                        biometricReservationId = "",
                        biometricBusy = false,
                        biometricError = "",
                        section = MainSection.RESERVATIONS,
                        message = "Rostro registrado y confirmado para esta reserva.",
                    )
                }
            } catch (error: Exception) {
                _state.update { it.copy(biometricBusy = false, biometricError = error.message ?: "No fue posible registrar la biometría.") }
            } finally {
                imageBytes.fill(0)
            }
        }
    }

    fun setQuery(value: String) = _state.update { it.copy(search = it.search.copy(query = value)) }
    fun setCheckIn(value: String) = _state.update { it.copy(search = it.search.copy(checkIn = value)) }
    fun setCheckOut(value: String) = _state.update { it.copy(search = it.search.copy(checkOut = value)) }
    fun setGuests(value: Int) = _state.update { it.copy(search = it.search.copy(guests = value.coerceIn(1, 20))) }

    fun clearSearch() = _state.update { it.copy(search = SearchCriteria()) }
    fun showProperty(property: LumaProperty) = _state.update {
        it.copy(selectedProperty = property, search = it.search.copy(guests = it.search.guests.coerceAtMost(property.guests)))
    }
    fun closeProperty() = _state.update { it.copy(selectedProperty = null) }

    fun startBooking(property: LumaProperty) {
        val current = _state.value
        val search = current.search
        val nights = nightCount(search.checkIn, search.checkOut)
        val message = when {
            search.checkIn.isBlank() || search.checkOut.isBlank() -> "Selecciona las fechas de entrada y salida."
            nights < 1 -> "La fecha de salida debe ser posterior a la entrada."
            search.guests > property.guests -> "Este alojamiento admite hasta ${property.guests} huéspedes."
            property.unavailableRanges.any { datesOverlap(search.checkIn, search.checkOut, it.checkIn, it.checkOut) } ->
                "Este alojamiento ya está ocupado durante una parte de las fechas seleccionadas."
            else -> ""
        }
        if (message.isNotBlank()) {
            _state.update { it.copy(message = message) }
            return
        }
        if (!current.readyToBook) {
            val reason = when {
                current.account == null -> "Inicia sesión o crea tu cuenta para reservar ${property.name}."
                current.account.emailVerified != true -> "Verifica tu correo para reservar ${property.name}."
                else -> "Registra tu RUT para reservar ${property.name}."
            }
            _state.update {
                it.copy(pendingBookingProperty = property, accountReason = reason, selectedProperty = null, section = MainSection.PROFILE)
            }
            return
        }
        _state.update { it.copy(bookingProperty = property) }
    }

    fun cancelBooking() = _state.update { it.copy(bookingProperty = null) }

    fun createReservation(property: LumaProperty, guest: GuestDraft) {
        val current = _state.value
        val account = current.account
        if (current.busyReservationId.isNotBlank() || account?.emailVerified != true) return
        if (property.unavailableRanges.any { datesOverlap(current.search.checkIn, current.search.checkOut, it.checkIn, it.checkOut) }) {
            _state.update { it.copy(message = "Estas fechas ya están ocupadas. Selecciona otros días.") }
            return
        }
        val nights = nightCount(current.search.checkIn, current.search.checkOut)
        val nightly = priceToNumber(property.price)
        val reservation = Reservation(
            id = makeReservationCode(),
            propertyId = property.id,
            propertyName = property.name,
            propertyPlace = property.place,
            propertyImage = property.image,
            guestName = guest.name.trim(),
            documentId = formatRut(guest.rut),
            email = account.email,
            phone = guest.phone.trim(),
            checkIn = current.search.checkIn,
            checkOut = current.search.checkOut,
            guests = current.search.guests,
            nights = nights,
            nightlyPrice = nightly,
            total = nightly * nights,
            accessPin = makeAccessPin(),
            createdAt = Instant.now().toString(),
            status = "pendiente-sincronizacion",
        )
        viewModelScope.launch {
            _state.update { it.copy(busyReservationId = reservation.id, message = "") }
            runCatching { cloud.createReservation(reservation) }
                .onSuccess {
                    // Mantiene el perfil al día con los datos usados en la reserva.
                    val profile = (current.profile ?: CustomerProfile()).copy(
                        name = reservation.guestName, documentId = reservation.documentId, phone = reservation.phone,
                    )
                    if (profile != current.profile) runCatching { cloud.saveProfile(profile, current.profile?.documentId.orEmpty()) }
                    val updated = listOf(reservation) + _state.value.reservations
                    store.save(updated)
                    _state.update {
                        it.copy(
                            reservations = updated,
                            profile = profile,
                            bookingProperty = null,
                            selectedProperty = null,
                            section = MainSection.RESERVATIONS,
                            paymentReservationId = reservation.id,
                            busyReservationId = "",
                            message = "Reserva enviada. Estamos preparando el pago con Webpay.",
                        )
                    }
                    watchReservationReady(reservation.id)
                }
                .onFailure { error ->
                    _state.update { it.copy(busyReservationId = "", message = error.message ?: "No fue posible crear la reserva.") }
                }
        }
    }

    private fun watchReservationReady(reservationId: String) {
        if (!reservationReadinessWatchers.add(reservationId)) return
        viewModelScope.launch {
            try {
                repeat(30) {
                    delay(2_000)
                    if (_state.value.reservations.none { it.id == reservationId && it.status == "pendiente-sincronizacion" }) return@launch
                    val result = runCatching { cloud.getReservationStatus(reservationId) }
                    if (result.getOrNull() != null) {
                        reservationReadinessWatchers.remove(reservationId)
                        loadMyReservations()
                        return@launch
                    }
                    if (result.exceptionOrNull()?.message?.contains("sesión actual") == true ||
                        result.exceptionOrNull()?.message?.contains("sesión venció") == true) {
                        _state.update { it.copy(message = result.exceptionOrNull()?.message.orEmpty()) }
                        return@launch
                    }
                }
                _state.update { it.copy(message = "El gestor sigue preparando la reserva. Pulsa Actualizar en unos momentos; aún no inicies el pago.") }
            } finally {
                reservationReadinessWatchers.remove(reservationId)
            }
        }
    }

    // Pide un QR de acceso vigente (el lector acepta cada QR un tiempo limitado).
    fun refreshAccessQr(reservationId: String) {
        viewModelScope.launch {
            val status = runCatching { cloud.getReservationStatus(reservationId) }.getOrNull() ?: return@launch
            val updated = _state.value.reservations.map {
                if (it.id == reservationId) it.copy(
                    accessQrImage = status.accessQrImage.ifBlank { it.accessQrImage },
                    accessQrExpiresAt = status.accessQrExpiresAt.ifBlank { it.accessQrExpiresAt },
                    dahuaQrStatus = status.dahuaQrStatus.ifBlank { it.dahuaQrStatus },
                ) else it
            }
            store.save(updated)
            _state.update { it.copy(reservations = updated) }
        }
    }

    fun phoneAccessMessage(message: String) {
        _state.update { it.copy(message = message) }
    }

    fun openDoorWithPhone(reservationId: String, requestId: String, signedAt: String,
                          publicKey: String, signature: String) {
        if (_state.value.doorAccessBusyId.isNotBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(doorAccessBusyId = reservationId, message = "Enviando apertura al terminal…") }
            runCatching { cloud.openDoorWithPhone(reservationId, requestId, signedAt, publicKey, signature) }
                .onSuccess { _state.update { it.copy(doorAccessBusyId = "", message = "Puerta abierta desde tu teléfono.") } }
                .onFailure { error -> _state.update { it.copy(doorAccessBusyId = "", message = error.message ?: "No fue posible abrir la puerta.") } }
        }
    }

    fun openDoorNow(reservationId: String) {
        if (_state.value.doorAccessBusyId.isNotBlank()) return
        _state.update { it.copy(doorAccessBusyId = reservationId, message = "Enviando apertura al terminal…") }
        viewModelScope.launch {
            runCatching { cloud.openDoorNow(reservationId) }
                .onSuccess { _state.update { it.copy(doorAccessBusyId = "", message = "Puerta abierta.") } }
                .onFailure { error -> _state.update { it.copy(doorAccessBusyId = "", message = error.message ?: "No fue posible abrir la puerta.") } }
        }
    }

    fun refreshReservation(reservation: Reservation, quiet: Boolean = false) {
        if (_state.value.busyReservationId.isNotBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(busyReservationId = reservation.id, message = "") }
            if (reservation.id in _state.value.pendingPaymentIds) {
                viewModelScope.launch { reconcilePaymentAttempt(reservation.id) }
            }
            runCatching { cloud.getReservationStatus(reservation.id) }
                .onSuccess { status ->
                    if (status == null) {
                        _state.update {
                            it.copy(busyReservationId = "", message = if (quiet) "" else "Tu reserva se está procesando. Inténtalo nuevamente en unos momentos.")
                        }
                        return@onSuccess
                    }
                    val approved = status.verified && status.paymentStatus == "aprobado-demo"
                    val updated = _state.value.reservations.map {
                        if (it.id == reservation.id) {
                            it.copy(
                                status = status.status.ifBlank { it.status },
                                verified = approved,
                                emailVerified = status.emailVerified,
                                paymentStatus = status.paymentStatus,
                                syncError = status.error,
                                confirmationEmailSent = status.confirmationEmailSent,
                                confirmationEmailError = status.confirmationEmailError,
                                biometricStatus = status.biometricStatus,
                                biometricEnrolledAt = status.biometricEnrolledAt,
                                biometricExpiresAt = status.biometricExpiresAt,
                                accessQrImage = status.accessQrImage.ifBlank { it.accessQrImage },
                                accessQrExpiresAt = status.accessQrExpiresAt.ifBlank { it.accessQrExpiresAt },
                                dahuaQrStatus = status.dahuaQrStatus.ifBlank { it.dahuaQrStatus },
                            )
                        } else it
                    }
                    store.save(updated)
                    val pdfs = if (status.pdfBase64.isNotBlank()) {
                        _state.value.pdfs + (reservation.id to PdfPayload(
                            base64 = status.pdfBase64,
                            fileName = status.pdfFileName.ifBlank { "RestBlu-${reservation.id}.pdf" },
                        ))
                    } else _state.value.pdfs
                    val paymentResolved = approved || status.paymentStatus == "reembolso-pendiente" ||
                        (status.status == "expirada" && paymentAttempt(reservation.id) == null)
                    val pending = if (paymentResolved) _state.value.pendingPaymentIds - reservation.id else _state.value.pendingPaymentIds
                    if (paymentResolved) {
                        store.savePendingPayments(pending)
                        store.clearPaymentAttempt(reservation.id)
                    }
                    _state.update {
                        it.copy(
                            reservations = updated,
                            busyReservationId = "",
                            pdfs = pdfs,
                            pendingPaymentIds = pending,
                            paymentReservationId = if (paymentResolved) "" else it.paymentReservationId,
                            message = when {
                                quiet -> ""
                                approved && status.dahuaQrStatus == "activo" -> "Pago confirmado. Tu QR de acceso ya está disponible."
                                approved -> "Pago confirmado. Estamos activando tu QR de acceso."
                                status.paymentStatus == "reembolso-pendiente" -> "Webpay aprobó el pago, pero las fechas ya no están disponibles. El gestor indica reembolso pendiente."
                                status.status == "expirada" && reservation.id in pending -> "La reserva venció sin confirmación del gestor. Si Webpay mostró un cobro, conserva el comprobante y no pagues de nuevo."
                                status.status == "expirada" -> "La reserva venció. Si Webpay mostró un cobro, conserva el comprobante y no pagues de nuevo."
                                reservation.id in pending -> "Webpay recibió tu pago. Espera la confirmación en Reservas; no vuelvas a pagar."
                                status.error.isNotBlank() -> status.error
                                else -> "Reserva pendiente de pago."
                            },
                        )
                    }
                }
                .onFailure { error ->
                    _state.update { it.copy(busyReservationId = "", message = if (quiet) "" else error.message ?: "No fue posible actualizar la reserva.") }
                    showLoginIfSessionLost()
                }
        }
    }

    fun openPayment(reservation: Reservation) {
        if (reservation.verified || reservation.paymentStatus == "aprobado-demo" || reservation.paymentStatus == "reembolso-pendiente") {
            _state.update { it.copy(section = MainSection.RESERVATIONS, paymentReservationId = "", message = "Esta reserva ya registra un pago. Actualízala para consultar su estado.") }
            return
        }
        if (reservation.id in _state.value.pendingPaymentIds) {
            _state.update { it.copy(section = MainSection.RESERVATIONS, paymentReservationId = "", message = "Tu pago ya está en verificación. No vuelvas a pagar; pulsa Actualizar para consultar el resultado.") }
            return
        }
        _state.update { it.copy(paymentReservationId = reservation.id, section = MainSection.RESERVATIONS) }
    }

    fun closePayment() = _state.update { it.copy(paymentReservationId = "") }

    // Abre Webpay en el navegador. La vuelta llega a handleWebpayReturn.
    fun payWithWebpay(reservation: Reservation) {
        if (reservation.verified || _state.value.busyReservationId.isNotBlank()) return
        if (reservation.id in _state.value.pendingPaymentIds) {
            openPayment(reservation)
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(busyReservationId = reservation.id, message = "") }
            try {
                // Una reserva puede haberse confirmado en otro dispositivo o
                // mientras la app esperaba la respuesta del gestor.
                val status = cloud.getReservationStatus(reservation.id)
                if (status == null) {
                    _state.update { it.copy(busyReservationId = "", message = "La reserva aún se está procesando. Actualízala antes de pagar.") }
                    return@launch
                }
                if (status.verified || status.paymentStatus == "aprobado-demo" || status.paymentStatus == "reembolso-pendiente") {
                    _state.update { it.copy(busyReservationId = "", paymentReservationId = "", section = MainSection.RESERVATIONS) }
                    refreshReservation(reservation)
                    return@launch
                }
                if (!status.emailVerified) {
                    _state.update { it.copy(busyReservationId = "", message = "Verifica tu correo antes de pagar esta reserva.") }
                    return@launch
                }
                if (status.status == "expirada") {
                    _state.update { it.copy(busyReservationId = "", paymentReservationId = "", message = "Esta reserva venció. Haz una nueva reserva; si Webpay mostró un cobro, conserva el comprobante.") }
                    return@launch
                }
                val checkout = cloud.createWebpayPayment(reservation.id, reservation.total)
                val ownerUid = _state.value.account?.uid.orEmpty()
                if (ownerUid.isBlank()) throw IllegalStateException("Inicia sesión antes de pagar.")
                store.savePaymentAttempt(WebpayAttempt(reservation.id, checkout.token,
                    UUID.randomUUID().toString(), ownerUid, System.currentTimeMillis(), checkout.payUrl))
                markPaymentPending(reservation.id)
                watchPaymentConfirmation(reservation.id)
                _state.update { it.copy(busyReservationId = "", webpayOpenUrl = checkout.payUrl, webpayPendingReservationId = reservation.id) }
            } catch (error: Exception) {
                _state.update { it.copy(busyReservationId = "", message = error.message ?: "No fue posible iniciar el pago.") }
                showLoginIfSessionLost()
            }
        }
    }

    fun consumeWebpayOpenUrl() = _state.update { it.copy(webpayOpenUrl = "") }

    fun continueWebpay(reservation: Reservation) {
        val attempt = paymentAttempt(reservation.id) ?: return
        if (!canContinueWebpay(reservation.id) || reservation.status == "expirada") return
        if (_state.value.busyReservationId.isNotBlank()) return
        viewModelScope.launch {
            _state.update { it.copy(busyReservationId = reservation.id, message = "") }
            runCatching { cloud.getWebpayPaymentState(reservation.id, attempt.token) }
                .onSuccess { result ->
                    when (result) {
                        WebpayPaymentState.APPROVED -> {
                            runCatching { sendApprovedPayment(attempt) }
                            _state.update { it.copy(busyReservationId = "", section = MainSection.RESERVATIONS) }
                            refreshReservation(reservation)
                        }
                        WebpayPaymentState.REJECTED -> {
                            clearPaymentPending(reservation.id)
                            _state.update { it.copy(busyReservationId = "", message = "Webpay rechazó este intento. Actualiza la reserva antes de volver a pagar.") }
                        }
                        WebpayPaymentState.PENDING -> _state.update { it.copy(busyReservationId = "",
                            webpayOpenUrl = attempt.payUrl, webpayPendingReservationId = reservation.id) }
                    }
                }
                .onFailure { _state.update { it.copy(busyReservationId = "",
                    message = "No pudimos consultar Webpay. Conservamos el intento; inténtalo más tarde.") } }
        }
    }

    fun webpayBrowserFailed() {
        _state.update { it.copy(webpayOpenUrl = "", webpayPendingReservationId = "",
            message = "No se pudo abrir Webpay. El intento quedó guardado; consulta Reservas antes de intentar otro pago.") }
    }

    fun handleWebpayReturn(uri: Uri) {
        if (uri.scheme != "restblu" || uri.host != "webpay") return
        val reservationId = uri.getQueryParameter("pago").orEmpty().ifBlank { _state.value.webpayPendingReservationId }
        val estado = uri.getQueryParameter("estado").orEmpty()
        val token = uri.getQueryParameter("token").orEmpty()
        val reservation = _state.value.reservations.firstOrNull { it.id == reservationId }
        _state.update { it.copy(webpayPendingReservationId = "", section = MainSection.RESERVATIONS, selectedProperty = null) }
        if (estado == "anulado" || estado == "expirado" || estado == "rechazado") {
            clearPaymentPending(reservationId)
            _state.update {
                it.copy(
                    paymentReservationId = reservationId,
                    message = when (estado) {
                        "anulado" -> "Cancelaste el pago en Webpay. Tu reserva sigue pendiente."
                        "expirado" -> "El tiempo para pagar se agotó. Puedes intentarlo de nuevo."
                        else -> "Webpay rechazó el pago. Puedes intentarlo con otra tarjeta."
                    },
                )
            }
            return
        }
        if (reservationId.isBlank()) {
            _state.update { it.copy(message = "No se pudo identificar la reserva del pago. Consulta Reservas antes de volver a pagar.") }
            return
        }
        if (paymentAttempt(reservationId) == null && token.matches(Regex("[A-Za-z0-9]{20,100}"))) {
            val ownerUid = _state.value.account?.uid.orEmpty()
            if (ownerUid.isNotBlank()) store.savePaymentAttempt(WebpayAttempt(reservationId, token,
                UUID.randomUUID().toString(), ownerUid, System.currentTimeMillis()))
        }
        markPaymentPending(reservationId)
        watchPaymentConfirmation(reservationId)
        _state.update { it.copy(paymentReservationId = "", message = if (estado == "aprobado")
            "Pago aprobado en Webpay. Estamos confirmando tu reserva; no vuelvas a pagar."
            else "Estamos consultando el resultado de Webpay; no inicies otro pago.") }
        viewModelScope.launch {
            val attempt = paymentAttempt(reservationId)
            runCatching {
                if (attempt != null && estado == "aprobado") sendApprovedPayment(attempt)
                else reconcilePaymentAttempt(reservationId)
            }
                .onSuccess {
                    _state.update { it.copy(paymentReservationId = "") }
                    reservation?.let { refreshReservation(it) } ?: loadMyReservations()
                }
                .onFailure {
                    _state.update { it.copy(paymentReservationId = "", message = "La confirmación del gestor sigue pendiente; consulta Reservas y no vuelvas a pagar.") }
                    loadMyReservations()
                }
        }
    }

    fun showAccess(reservation: Reservation) {
        if (!reservation.verified) {
            _state.update { it.copy(message = "Completa el pago para habilitar tu acceso.") }
            return
        }
        _state.update { it.copy(section = MainSection.ACCESS, selectedProperty = null, activeReservationId = reservation.id) }
    }

    fun selectAccessReservation(reservationId: String) = _state.update { it.copy(activeReservationId = reservationId) }

    fun consumeMessage() = _state.update { it.copy(message = "") }

    fun filteredProperties(): List<LumaProperty> {
        val current = _state.value
        val query = normalizeSearch(current.search.query)
        return current.properties.filter { property ->
            val searchable = normalizeSearch(listOf(property.name, property.place, property.type).plus(property.tags).joinToString(" "))
            val available = property.unavailableRanges.none {
                datesOverlap(current.search.checkIn, current.search.checkOut, it.checkIn, it.checkOut)
            }
            (query.isBlank() || searchable.contains(query)) && current.search.guests <= property.guests && available
        }
    }
}

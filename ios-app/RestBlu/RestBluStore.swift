import Foundation
import SwiftUI

@MainActor
final class RestBluStore: ObservableObject {
    @Published var account: CustomerAccount? = SecureSession.read()?.account
    @Published var profile = CustomerProfile()
    @Published var properties: [Property] = []
    @Published var reservations: [Reservation] = LocalReservations.read()
    @Published var query = ""
    @Published var checkIn = Date()
    @Published var checkOut = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @Published var guests = 2
    @Published var busy = false
    @Published var notice = ""
    @Published var paymentURL: URL?
    @Published var aiMessages: [AIMessage] = []
    @Published var aiBusy = false

    let api = RestBluAPI()

    var filteredProperties: [Property] {
        properties.filter { property in
            let search = query.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            let text = ([property.name, property.place, property.type] + property.tags).joined(separator: " ")
                .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            return (search.isEmpty || text.localizedCaseInsensitiveContains(search)) &&
                property.guests >= guests && RestBluFormat.available(property, from: checkIn, to: checkOut)
        }
    }

    func start() async {
        await loadCatalog()
        if account != nil {
            await loadProfile()
            await refreshReservations()
            await resumePayments()
        }
    }

    func loadCatalog() async {
        do { properties = try await api.properties() }
        catch { notice = "No se pudo cargar el catálogo: \(error.localizedDescription)" }
    }

    func loadProfile() async {
        do { profile = try await api.loadProfile() ?? CustomerProfile() }
        catch { notice = error.localizedDescription }
    }

    func register(name: String, rut: String, phone: String, email: String, password: String) async {
        guard !busy else { return }
        guard name.trimmingCharacters(in: .whitespaces).count >= 2, RestBluFormat.validRUT(rut),
              phone.filter(\.isNumber).count >= 8, password.count >= 6 else {
            notice = "Revisa nombre, RUT, teléfono y contraseña (mínimo 6 caracteres)."; return
        }
        busy = true
        defer { busy = false }
        do {
            let newProfile = CustomerProfile(name: name, documentID: RestBluFormat.rut(rut), phone: phone)
            account = try await api.register(email: email, password: password, profile: newProfile)
            profile = newProfile
            notice = "Cuenta creada. Revisa tu correo y verifica el código antes de reservar."
        } catch { notice = error.localizedDescription }
    }

    func login(email: String, password: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            account = try await api.login(email: email, password: password)
            await loadProfile()
            await refreshReservations()
            await resumePayments()
        } catch { notice = error.localizedDescription }
    }

    func sendVerificationCode() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do { try await api.sendVerificationCode(); notice = "Enviamos un código de seis dígitos a tu correo." }
        catch { notice = error.localizedDescription }
    }

    func verifyCode(_ code: String) async {
        guard !busy else { return }
        guard code.count == 6 && code.allSatisfy(\.isNumber) else { notice = "Escribe los seis dígitos del código."; return }
        busy = true
        defer { busy = false }
        do { account = try await api.verifyCode(code); notice = "Correo verificado."; await refreshReservations() }
        catch { notice = error.localizedDescription }
    }

    func resetPassword(_ email: String) async {
        do { try await api.resetPassword(email); notice = "Si existe la cuenta, recibirás el enlace de recuperación." }
        catch { notice = error.localizedDescription }
    }

    func saveProfile(_ updated: CustomerProfile) async {
        guard RestBluFormat.validRUT(updated.documentID) else { notice = "RUT inválido."; return }
        busy = true
        defer { busy = false }
        do {
            var normalized = updated
            normalized.documentID = RestBluFormat.rut(updated.documentID)
            try await api.saveProfile(normalized, previousRUT: profile.documentID)
            profile = normalized
            notice = "Perfil actualizado."
        } catch { notice = error.localizedDescription }
    }

    func logout() async {
        await api.logout()
        account = nil
        profile = CustomerProfile()
        reservations = []
        LocalReservations.write([])
        notice = "Sesión cerrada."
    }

    func book(_ property: Property, name: String, phone: String) async -> Bool {
        guard !busy else { return false }
        guard let account, account.emailVerified else { notice = "Verifica tu correo antes de reservar."; return false }
        let nights = RestBluFormat.nights(checkIn, checkOut)
        guard (1...365).contains(nights), guests <= property.guests,
              RestBluFormat.available(property, from: checkIn, to: checkOut),
              RestBluFormat.validRUT(profile.documentID), name.count >= 2, phone.filter(\.isNumber).count >= 8 else {
            notice = "Revisa fechas, disponibilidad y datos del huésped."; return false
        }
        let reservation = Reservation(id: RestBluFormat.reservationCode(), propertyID: property.id,
                                      propertyName: property.name, propertyPlace: property.place, propertyImage: property.image,
                                      guestName: name, documentID: RestBluFormat.rut(profile.documentID), email: account.email,
                                      phone: phone, checkIn: RestBluFormat.date(checkIn), checkOut: RestBluFormat.date(checkOut),
                                      guests: guests, nights: nights, nightlyPrice: property.nightlyPrice,
                                      total: property.nightlyPrice * nights, accessPIN: RestBluFormat.accessPIN(),
                                      createdAt: ISO8601DateFormatter().string(from: Date()))
        busy = true
        defer { busy = false }
        do {
            try await api.createReservation(reservation)
            reservations.insert(reservation, at: 0)
            LocalReservations.write(reservations)
            notice = "Reserva enviada. El gestor debe procesarla antes de pagar."
            return true
        } catch { notice = error.localizedDescription; return false }
    }

    func refreshReservations() async {
        guard account?.emailVerified == true else { return }
        do {
            let remote = try await api.myReservations()
            let local = reservations.filter { pending in
                pending.status == "pendiente-sincronizacion" && !remote.contains(where: { $0.id == pending.id })
            }
            reservations = (remote + local).sorted { $0.createdAt > $1.createdAt }
            LocalReservations.write(reservations)
            for reservation in remote where reservation.verified || reservation.paymentStatus == "reembolso-pendiente" {
                LocalReservations.removeAttempt(reservation.id)
            }
        } catch { notice = error.localizedDescription }
    }

    func refreshReservation(_ id: String) async {
        do {
            guard var remote = try await api.reservationStatus(id) else {
                notice = "El gestor todavía está preparando la reserva."; return
            }
            if let old = reservations.first(where: { $0.id == id }) {
                remote.propertyImage = old.propertyImage
            }
            reservations.removeAll { $0.id == id }
            reservations.insert(remote, at: 0)
            LocalReservations.write(reservations)
            if remote.verified || remote.paymentStatus == "reembolso-pendiente" { LocalReservations.removeAttempt(id) }
        } catch { notice = error.localizedDescription }
    }

    func beginPayment(_ reservation: Reservation) async {
        guard !busy else { return }
        if LocalReservations.attempts()[reservation.id] != nil {
            notice = "Ya hay un intento de pago. Consulta su resultado antes de iniciar otro."; return
        }
        busy = true
        defer { busy = false }
        do {
            guard let current = try await api.reservationStatus(reservation.id) else {
                notice = "El gestor aún no prepara esta reserva."; return
            }
            guard !current.verified && current.paymentStatus != "reembolso-pendiente" && current.status != "expirada" else {
                notice = "Esta reserva ya tiene un resultado. Actualízala."; return
            }
            guard current.emailVerified else { notice = "Verifica el correo de esta reserva antes de pagar."; return }
            let attempt = try await api.createPayment(for: current)
            LocalReservations.save(attempt)
            paymentURL = URL(string: attempt.payURL)
            notice = "Se abrirá Webpay. Si vuelves sin resultado, consulta esta reserva; no pagues de nuevo."
        } catch { notice = error.localizedDescription }
    }

    func handlePaymentReturn(_ link: URL) async {
        guard link.scheme == "restblu-ios", link.host == "webpay" else { return }
        let parts = URLComponents(url: link, resolvingAgainstBaseURL: false)
        let id = parts?.queryItems?.first(where: { $0.name == "pago" })?.value ?? ""
        guard let attempt = LocalReservations.attempts()[id] else { notice = "No se encontró el intento de pago. Consulta Reservas."; return }
        let receivedToken = parts?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
        guard receivedToken.isEmpty || receivedToken == attempt.token else {
            notice = "El enlace de pago no coincide con este intento. Consulta Reservas."; return
        }
        // El enlace es sólo una señal para consultar Webpay; nunca determina el resultado.
        await reconcile(attempt)
    }

    func resumePayments() async {
        guard let uid = account?.uid else { return }
        for attempt in LocalReservations.attempts().values where attempt.ownerUID == uid {
            await reconcile(attempt)
        }
    }

    private func reconcile(_ attempt: PaymentAttempt) async {
        do {
            switch try await api.paymentState(attempt) {
            case .approved:
                try await api.submitApprovedPayment(attempt)
                await refreshReservation(attempt.reservationID)
                notice = "Pago aprobado. Espera la confirmación de tu pase."
            case .rejected:
                LocalReservations.removeAttempt(attempt.reservationID)
                notice = "Webpay rechazó el intento. Actualiza la reserva antes de intentar nuevamente."
            case .pending:
                notice = "El pago sigue pendiente de confirmación. No vuelvas a pagar."
            }
        } catch { notice = "No se pudo confirmar el pago: \(error.localizedDescription). El intento permanece guardado." }
    }

    func openDoor(_ reservation: Reservation, biometric: Bool) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            if biometric { try await api.openDoorWithPhone(reservation.id) }
            else { try await api.openDoorDirectly(reservation.id) }
            notice = "El terminal confirmó la apertura."
        } catch { notice = error.localizedDescription }
    }

    func enrollFace(_ jpeg: Data, reservation: Reservation) async {
        guard reservation.verified, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await api.enrollFace(jpeg, reservationID: reservation.id, documentID: reservation.documentID)
            await refreshReservation(reservation.id)
            notice = "El gestor confirmó el registro facial."
        } catch { notice = error.localizedDescription }
    }

    func askBlu(_ question: String) async {
        guard !aiBusy, question.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 else { return }
        let previous = aiMessages
        aiMessages.append(AIMessage(role: "user", content: question))
        aiBusy = true
        defer { aiBusy = false }
        do {
            let answer = try await api.askBlu(question, history: previous, query: query,
                                              checkIn: RestBluFormat.date(checkIn), checkOut: RestBluFormat.date(checkOut), guests: guests)
            aiMessages.append(AIMessage(role: "assistant", content: answer))
        } catch { notice = error.localizedDescription }
    }
}

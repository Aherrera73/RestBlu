import Foundation

enum RestBluConfig {
    static let projectID = "lumastay-bab6a"
    // Identificador público del proyecto Firebase; la autorización depende de Auth y Firestore Rules.
    static let firebaseAPIKey = "AIzaSyADKsieNglFr6XRdWOOCJUwQURz5uc8gKI"
    static let paymentsAPI = URL(string: "https://restblu-pagos.restblu.workers.dev")!
    static let firestore = URL(string: "https://firestore.googleapis.com/v1/projects/\(projectID)/databases/(default)/documents")!
    static let paymentReturn = "restblu-ios://webpay"
}

struct Property: Identifiable, Hashable {
    let id: Int
    let name: String
    let place: String
    let type: String
    let guests: Int
    let beds: Int
    let baths: Int
    let nightlyPrice: Int
    let image: String
    let gallery: [String]
    let tags: [String]
    let unavailable: [DateRange]

    static func == (lhs: Property, rhs: Property) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct DateRange: Hashable {
    let checkIn: String
    let checkOut: String
}

struct CustomerAccount {
    let uid: String
    let email: String
    let emailVerified: Bool
}

struct CustomerProfile {
    var name = ""
    var documentID = ""
    var phone = ""
    var birthDate = ""
    var nationality = ""
    var emergencyContactName = ""
    var emergencyContactPhone = ""
    var favorites: [Int] = []
}

struct Reservation: Identifiable, Codable {
    var id: String
    var propertyID: Int
    var propertyName: String
    var propertyPlace: String
    var propertyImage: String
    var guestName: String
    var documentID: String
    var email: String
    var phone: String
    var checkIn: String
    var checkOut: String
    var guests: Int
    var nights: Int
    var nightlyPrice: Int
    var total: Int
    var accessPIN: String
    var createdAt: String
    var status: String = "pendiente-sincronizacion"
    var paymentStatus: String = "pendiente-demo"
    var verified = false
    var emailVerified = false
    var biometricStatus = "sin-registrar"
    var dahuaQRStatus = ""
    var accessQRImage = ""
    var accessQRExpiresAt = ""
    var pdfBase64 = ""
    var pdfFileName = ""
    var error = ""
}

struct PaymentAttempt: Codable {
    let reservationID: String
    let token: String
    let requestID: String
    let ownerUID: String
    let payURL: String
    let createdAt: Date
}

struct AIMessage: Identifiable {
    let id = UUID()
    let role: String
    let content: String
}

enum RestBluError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let text) = self { return text }
        return nil
    }
}

enum RestBluFormat {
    static let isoDate: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func date(_ value: Date) -> String { isoDate.string(from: value) }
    static func nights(_ start: Date, _ end: Date) -> Int {
        Calendar(identifier: .gregorian).dateComponents([.day], from: start, to: end).day ?? 0
    }
    static func currency(_ value: Int) -> String {
        value.formatted(.currency(code: "CLP").precision(.fractionLength(0)).locale(Locale(identifier: "es_CL")))
    }
    static func reservationCode() -> String {
        let time = String(Int(Date().timeIntervalSince1970 * 1000), radix: 36).uppercased().suffix(6)
        let random = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
        return "RB-\(time)-\(random)"
    }
    static func accessPIN() -> String { String(Int.random(in: 100_000...999_999)) }
    static func rut(_ value: String) -> String {
        let clean = value.uppercased().filter { $0.isNumber || $0 == "K" }
        guard clean.count > 1 else { return clean }
        let body = String(clean.dropLast())
        let grouped = String(body.reversed()).splitEvery(3).joined(separator: ".")
        return String(grouped.reversed()) + "-" + String(clean.suffix(1))
    }
    static func validRUT(_ value: String) -> Bool {
        let clean = value.uppercased().filter { $0.isNumber || $0 == "K" }
        guard (8...9).contains(clean.count), let digit = clean.last else { return false }
        let body = clean.dropLast()
        guard body.allSatisfy({ $0.isNumber }) else { return false }
        var multiplier = 2
        var sum = 0
        for character in body.reversed() {
            sum += (character.wholeNumberValue ?? 0) * multiplier
            multiplier = multiplier == 7 ? 2 : multiplier + 1
        }
        let remainder = 11 - sum % 11
        let expected: Character = remainder == 11 ? "0" : remainder == 10 ? "K" : Character(String(remainder))
        return digit == expected
    }
    static func available(_ property: Property, from start: Date, to end: Date) -> Bool {
        let checkIn = date(start), checkOut = date(end)
        return property.unavailable.allSatisfy { checkIn >= $0.checkOut || checkOut <= $0.checkIn }
    }
}

private extension String {
    func splitEvery(_ count: Int) -> [String] {
        stride(from: 0, to: self.count, by: count).map { offset in
            String(self[index(startIndex, offsetBy: offset)..<index(startIndex, offsetBy: Swift.min(offset + count, self.count))])
        }
    }
}

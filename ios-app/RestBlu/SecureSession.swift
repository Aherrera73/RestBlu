import Foundation
import Security

struct FirebaseSession: Codable {
    let idToken: String
    let refreshToken: String
    let uid: String
    let expiresAt: Date

    var account: CustomerAccount? {
        let parts = idToken.split(separator: ".")
        guard parts.count > 1 else { return nil }
        let payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let padded = payload + String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let bytes = Data(base64Encoded: padded),
              let json = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let email = json["email"] as? String, !email.isEmpty else { return nil }
        return CustomerAccount(uid: uid, email: email, emailVerified: json["email_verified"] as? Bool ?? false)
    }
}

enum SecureSession {
    private static let service = "cl.restblu.huesped.firebase-session"

    static func read() -> FirebaseSession? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "firebase",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        query.removeAll()
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(FirebaseSession.self, from: data)
    }

    static func write(_ session: FirebaseSession) throws {
        let data = try JSONEncoder().encode(session)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "firebase",
        ]
        let update: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
                throw RestBluError.message("No se pudo guardar la sesión del iPhone.")
            }
        } else if status != errSecSuccess {
            throw RestBluError.message("No se pudo actualizar la sesión del iPhone.")
        }
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "firebase",
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum LocalReservations {
    private static let key = "restblu-ios-reservations-v1"
    private static let paymentKey = "restblu-ios-payment-attempts-v1"

    static func read() -> [Reservation] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Reservation].self, from: data)) ?? []
    }
    static func write(_ reservations: [Reservation]) {
        guard let data = try? JSONEncoder().encode(reservations) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
    static func attempts() -> [String: PaymentAttempt] {
        guard let data = UserDefaults.standard.data(forKey: paymentKey) else { return [:] }
        return (try? JSONDecoder().decode([String: PaymentAttempt].self, from: data)) ?? [:]
    }
    static func save(_ attempt: PaymentAttempt) {
        var all = attempts()
        all[attempt.reservationID] = attempt
        if let data = try? JSONEncoder().encode(all) { UserDefaults.standard.set(data, forKey: paymentKey) }
    }
    static func removeAttempt(_ id: String) {
        var all = attempts()
        all.removeValue(forKey: id)
        if let data = try? JSONEncoder().encode(all) { UserDefaults.standard.set(data, forKey: paymentKey) }
    }
}

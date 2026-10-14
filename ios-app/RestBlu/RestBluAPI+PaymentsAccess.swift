import Foundation
import CryptoKit
import Security

enum WebpayState: String { case approved, pending, rejected }

extension RestBluAPI {
    func createPayment(for reservation: Reservation) async throws -> PaymentAttempt {
        let session = try await activeSession()
        let body: [String: Any] = ["reservationId": reservation.id, "amount": reservation.total,
                                   "returnTo": RestBluConfig.paymentReturn]
        let response = try await call(RestBluConfig.paymentsAPI.appendingPathComponent("webpay/create"), method: "POST", body: body)
        let payload = try checked(response, "Webpay no pudo iniciar el pago.")
        let token = payload.text("token"), payURL = payload.text("payUrl")
        guard token.range(of: "^[A-Za-z0-9]{20,100}$", options: .regularExpression) != nil,
              URL(string: payURL)?.scheme == "https" else { throw RestBluError.message("Webpay entregó una respuesta inválida.") }
        return PaymentAttempt(reservationID: reservation.id, token: token, requestID: UUID().uuidString.lowercased(),
                              ownerUID: session.uid, payURL: payURL, createdAt: Date())
    }

    func paymentState(_ attempt: PaymentAttempt) async throws -> WebpayState {
        let result = try checked(await call(RestBluConfig.paymentsAPI.appendingPathComponent("webpay/status"), method: "POST",
                                            body: ["reservationId": attempt.reservationID, "token": attempt.token]),
                                 "No se pudo consultar el pago. No inicies otro cobro.")
        return WebpayState(rawValue: result.text("state")) ?? .pending
    }

    func submitApprovedPayment(_ attempt: PaymentAttempt) async throws {
        let id = try await createBridge("reservation_payment_requests", ["reservationId": attempt.reservationID,
                                                                  "webpayToken": attempt.token], fixedID: attempt.requestID)
        _ = try await awaitBridge("reservation_payment_requests", id)
    }

    func openDoorDirectly(_ reservationID: String) async throws {
        let id = try await createBridge("tap_access_requests", ["reservationId": reservationID])
        _ = try await awaitBridge("tap_access_requests", id, interval: 500_000_000)
    }

    func openDoorWithPhone(_ reservationID: String) async throws {
        let session = try await activeSession()
        let requestID = UUID().uuidString.lowercased()
        let signedAt = ISO8601DateFormatter().string(from: Date())
        let payload = "RESTBLU_PHONE_ACCESS_V1\n\(session.uid)\n\(reservationID)\n\(requestID)\n\(signedAt)"
        let credential = try PhoneAccessKey.sign(payload: payload, ownerUID: session.uid)
        let values: [String: Any] = ["reservationId": reservationID, "signedAt": signedAt,
                                     "publicKey": credential.publicKey, "signature": credential.signature]
        let id = try await createBridge("phone_access_requests", values, fixedID: requestID)
        _ = try await awaitBridge("phone_access_requests", id, interval: 1_000_000_000)
    }

    func askBlu(_ question: String, history: [AIMessage], query: String, checkIn: String,
                checkOut: String, guests: Int) async throws -> String {
        let input: [String: Any] = [
            "question": String(question.prefix(1_500)),
            "history": history.suffix(6).map { ["role": $0.role, "content": String($0.content.prefix(1_500))] },
            "search": ["destination": query, "checkIn": checkIn, "checkOut": checkOut, "guests": guests] as [String: Any],
        ]
        let id = try await createBridge("public_ai_requests", input)
        let result = try await awaitBridge("public_ai_requests", id, interval: 1_000_000_000)
        let answer = result.text("answer").isEmpty ? result.text("partialAnswer") : result.text("answer")
        guard !answer.isEmpty else { throw RestBluError.message("Blu no entregó una respuesta.") }
        return answer
    }

    func enrollFace(_ jpeg: Data, reservationID: String, documentID: String) async throws {
        let payload = try checked(await call(firebaseURL("public_biometric_config/current")), "El gestor no publicó la clave biométrica.")
        let fields = FirestoreCodec.fields(payload["fields"] as? [String: Any] ?? [:])
        let pem = fields.text("publicKey"), keyID = fields.text("keyId")
        let base64 = pem.components(separatedBy: .newlines).filter { !$0.hasPrefix("-----") }.joined()
        guard let der = Data(base64Encoded: base64), !keyID.isEmpty,
              let publicKey = SecKeyCreateWithData(der as CFData, [
                kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
                kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
            ] as CFDictionary, nil) else { throw RestBluError.message("Clave biométrica inválida.") }
        let symmetric = SymmetricKey(size: .bits256)
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(jpeg, using: symmetric, nonce: nonce)
        let cipher = sealed.ciphertext + sealed.tag
        guard cipher.count <= 600_000 else { throw RestBluError.message("La foto es demasiado grande.") }
        let keyData = symmetric.withUnsafeBytes { Data($0) }
        var error: Unmanaged<CFError>?
        guard let wrapped = SecKeyCreateEncryptedData(publicKey, .rsaEncryptionOAEPSHA256, keyData as CFData, &error) as Data? else {
            throw RestBluError.message("No se pudo cifrar la foto.")
        }
        let nonceData = nonce.withUnsafeBytes { Data($0) }
        let values: [String: Any] = ["reservationId": reservationID, "documentId": documentID,
                                     "consent": true, "dahuaConsent": true, "mimeType": "image/jpeg",
                                     "encryptedImage": cipher.base64EncodedString(), "encryptedKey": wrapped.base64EncodedString(),
                                     "iv": nonceData.base64EncodedString(), "keyId": keyID]
        let id = try await createBridge("public_biometric_requests", values)
        let result = try await awaitBridge("public_biometric_requests", id)
        guard result.text("status") == "activa" else { throw RestBluError.message("El gestor no confirmó el registro facial.") }
    }
}

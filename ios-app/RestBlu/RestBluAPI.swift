import Foundation

actor RestBluAPI {
    let http = URLSession.shared

    func url(_ base: String, _ items: [URLQueryItem] = []) throws -> URL {
        guard var parts = URLComponents(string: base) else { throw RestBluError.message("Dirección de servicio inválida.") }
        parts.queryItems = (parts.queryItems ?? []) + items
        guard let result = parts.url else { throw RestBluError.message("Dirección de servicio inválida.") }
        return result
    }

    func firebaseURL(_ path: String, _ items: [URLQueryItem] = []) throws -> URL {
        try url("\(RestBluConfig.firestore.absoluteString)/\(path)", items + [URLQueryItem(name: "key", value: RestBluConfig.firebaseAPIKey)])
    }

    func call(_ target: URL, method: String = "GET", body: [String: Any]? = nil,
                      bearer: String? = nil, override: String? = nil) async throws -> (Int, Any) {
        var request = URLRequest(url: target)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let override { request.setValue(override, forHTTPHeaderField: "X-HTTP-Method-Override") }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await http.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) ?? [:]
        return (code, json)
    }

    func checked(_ result: (Int, Any), _ message: String) throws -> [String: Any] {
        if (200...299).contains(result.0) { return result.1 as? [String: Any] ?? [:] }
        let payload = result.1 as? [String: Any] ?? [:]
        let error = payload["error"] as? [String: Any]
        let detail = error?.text("message") ?? payload.text("error")
        throw RestBluError.message(detail.isEmpty ? message : "\(message) (\(detail))")
    }

    private func identity(_ operation: String, _ body: [String: Any]) async throws -> [String: Any] {
        let target = try url("https://identitytoolkit.googleapis.com/v1/\(operation)", [URLQueryItem(name: "key", value: RestBluConfig.firebaseAPIKey)])
        return try checked(await call(target, method: "POST", body: body), "No fue posible completar la operación de cuenta.")
    }

    func activeSession() async throws -> FirebaseSession {
        guard let cached = SecureSession.read() else { throw RestBluError.message("Inicia sesión para continuar.") }
        if cached.expiresAt > Date().addingTimeInterval(60) { return cached }
        guard !cached.refreshToken.isEmpty else { throw RestBluError.message("Tu sesión venció. Ingresa de nuevo.") }
        let target = try url("https://securetoken.googleapis.com/v1/token", [URLQueryItem(name: "key", value: RestBluConfig.firebaseAPIKey)])
        var request = URLRequest(url: target)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = "grant_type=refresh_token&refresh_token=\(cached.refreshToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")".data(using: .utf8)
        let (data, response) = try await http.data(for: request)
        if (response as? HTTPURLResponse)?.statusCode == 400 {
            SecureSession.clear()
            throw RestBluError.message("Tu sesión venció. Ingresa de nuevo con la cuenta de la reserva.")
        }
        guard let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = raw["id_token"] as? String else { throw RestBluError.message("No se pudo renovar la sesión.") }
        let session = FirebaseSession(idToken: token, refreshToken: raw.text("refresh_token").isEmpty ? cached.refreshToken : raw.text("refresh_token"),
                                      uid: raw.text("user_id").isEmpty ? cached.uid : raw.text("user_id"),
                                      expiresAt: Date().addingTimeInterval(TimeInterval(Int(raw.text("expires_in")) ?? 3600)))
        try SecureSession.write(session)
        return session
    }

    private func savedSession(_ result: [String: Any]) throws -> CustomerAccount {
        guard !result.text("idToken").isEmpty, !result.text("localId").isEmpty else {
            throw RestBluError.message("Firebase no entregó una sesión válida.")
        }
        let session = FirebaseSession(idToken: result.text("idToken"), refreshToken: result.text("refreshToken"),
                                      uid: result.text("localId"), expiresAt: Date().addingTimeInterval(TimeInterval(Int(result.text("expiresIn")) ?? 3600)))
        try SecureSession.write(session)
        guard let account = session.account else { throw RestBluError.message("No se pudo leer la cuenta.") }
        return account
    }

    func register(email: String, password: String, profile: CustomerProfile) async throws -> CustomerAccount {
        let result = try await identity("accounts:signUp", ["email": email.lowercased(), "password": password, "returnSecureToken": true])
        let account = try savedSession(result)
        do { try await saveProfile(profile, previousRUT: "") }
        catch {
            _ = try? await identity("accounts:delete", ["idToken": result.text("idToken")])
            SecureSession.clear()
            throw error
        }
        _ = try? await createBridge("account_verification_requests", ["action": "send", "code": ""])
        return account
    }

    func login(email: String, password: String) async throws -> CustomerAccount {
        try savedSession(await identity("accounts:signInWithPassword", ["email": email.lowercased(), "password": password, "returnSecureToken": true]))
    }

    func refreshAccount() async throws -> CustomerAccount? {
        // La renovación fuerza la obtención de los claims actualizados tras verificar el correo.
        guard let old = SecureSession.read() else { return nil }
        try SecureSession.write(FirebaseSession(idToken: old.idToken, refreshToken: old.refreshToken, uid: old.uid, expiresAt: .distantPast))
        let session = try await activeSession()
        return session.account
    }

    func sendVerificationCode() async throws {
        let id = try await createBridge("account_verification_requests", ["action": "send", "code": ""])
        _ = try await awaitBridge("account_verification_requests", id)
    }

    func verifyCode(_ code: String) async throws -> CustomerAccount {
        let id = try await createBridge("account_verification_requests", ["action": "verify", "code": code])
        _ = try await awaitBridge("account_verification_requests", id)
        guard let account = try await refreshAccount(), account.emailVerified else {
            throw RestBluError.message("La cuenta todavía no aparece verificada. Inténtalo nuevamente.")
        }
        return account
    }

    func resetPassword(_ email: String) async throws {
        _ = try await identity("accounts:sendOobCode", ["requestType": "PASSWORD_RESET", "email": email.lowercased()])
    }

    func loadProfile() async throws -> CustomerProfile? {
        let session = try await activeSession()
        let response = try await call(firebaseURL("customer_profiles/\(session.uid)"), bearer: session.idToken)
        if response.0 == 404 { return nil }
        let payload = try checked(response, "No se pudo cargar el perfil.")
        let fields = FirestoreCodec.fields(payload["fields"] as? [String: Any] ?? [:])
        return CustomerProfile(name: fields.text("name"), documentID: fields.text("documentId"), phone: fields.text("phone"),
                               birthDate: fields.text("birthDate"), nationality: fields.text("nationality"),
                               emergencyContactName: fields.text("emergencyContactName"), emergencyContactPhone: fields.text("emergencyContactPhone"),
                               favorites: fields["favorites"] as? [Int] ?? [])
    }

    func saveProfile(_ profile: CustomerProfile, previousRUT: String) async throws {
        let session = try await activeSession()
        let rutKey = profile.documentID.uppercased().filter { $0.isNumber || $0 == "K" }
        let claim = try await call(firebaseURL("rut_index", [URLQueryItem(name: "documentId", value: rutKey)]), method: "POST",
                                   body: ["fields": FirestoreCodec.wrap(["uid": session.uid, "createdAt": ISO8601DateFormatter().string(from: Date())])], bearer: session.idToken)
        if !(200...299).contains(claim.0) {
            let own = try await call(firebaseURL("rut_index/\(rutKey)"), bearer: session.idToken)
            guard (200...299).contains(own.0) else { throw RestBluError.message("Este RUT ya está asociado a otra cuenta o no pudo validarse.") }
        }
        let values: [String: Any] = ["name": profile.name, "documentId": profile.documentID, "phone": profile.phone,
                                     "birthDate": profile.birthDate, "nationality": profile.nationality,
                                     "emergencyContactName": profile.emergencyContactName, "emergencyContactPhone": profile.emergencyContactPhone,
                                     "favorites": profile.favorites, "updatedAt": ISO8601DateFormatter().string(from: Date())]
        let response = try await call(firebaseURL("customer_profiles/\(session.uid)"), method: "POST", body: ["fields": FirestoreCodec.wrap(values)],
                                      bearer: session.idToken, override: "PATCH")
        _ = try checked(response, "No se pudo guardar el perfil.")
        let oldKey = previousRUT.uppercased().filter { $0.isNumber || $0 == "K" }
        if !oldKey.isEmpty && oldKey != rutKey {
            _ = try? await call(firebaseURL("rut_index/\(oldKey)"), method: "DELETE", bearer: session.idToken)
        }
    }

    func logout() { SecureSession.clear() }
}

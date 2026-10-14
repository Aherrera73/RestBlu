import Foundation

extension RestBluAPI {
    func properties() async throws -> [Property] {
        var output: [Property] = []
        var page = ""
        repeat {
            let items = [URLQueryItem(name: "pageSize", value: "100")] + (page.isEmpty ? [] : [URLQueryItem(name: "pageToken", value: page)])
            let payload = try checked(await call(firebaseURL("public_properties", items)), "No se pudo consultar el catálogo.")
            for document in payload["documents"] as? [[String: Any]] ?? [] {
                let fields = FirestoreCodec.fields(document["fields"] as? [String: Any] ?? [:])
                let gallery = (fields["gallery"] as? [[String: Any]] ?? []).map { $0.text("src") }.filter { !$0.isEmpty }
                let unavailable = (fields["unavailableRanges"] as? [[String: Any]] ?? []).map {
                    DateRange(checkIn: $0.text("checkIn"), checkOut: $0.text("checkOut"))
                }
                output.append(Property(id: fields.int("id"), name: fields.text("name"), place: fields.text("place"),
                                       type: fields.text("type"), guests: fields.int("guests"), beds: fields.int("beds"), baths: fields.int("baths"),
                                       nightlyPrice: Int(fields.text("price").filter(\.isNumber)) ?? 0, image: fields.text("image"), gallery: gallery,
                                       tags: fields["tags"] as? [String] ?? [], unavailable: unavailable))
            }
            page = payload.text("nextPageToken")
        } while !page.isEmpty
        return output.sorted { $0.name < $1.name }
    }

    func createReservation(_ reservation: Reservation) async throws {
        let session = try await activeSession()
        guard session.account?.emailVerified == true else { throw RestBluError.message("Verifica tu correo antes de reservar.") }
        let values: [String: Any] = [
            "id": reservation.id, "guestName": reservation.guestName, "documentId": reservation.documentID,
            "email": session.account?.email ?? "", "phone": reservation.phone, "propertyId": reservation.propertyID,
            "propertyName": reservation.propertyName, "propertyPlace": reservation.propertyPlace,
            "checkIn": reservation.checkIn, "checkOut": reservation.checkOut, "guests": reservation.guests,
            "nights": reservation.nights, "nightlyPrice": reservation.nightlyPrice, "total": reservation.total,
            "accessPin": reservation.accessPIN, "syncStatus": "pending", "source": "ios-app",
            "schemaVersion": 3, "createdAt": reservation.createdAt, "ownerUid": session.uid,
        ]
        let target = try firebaseURL("reservation_intake", [URLQueryItem(name: "documentId", value: reservation.id)])
        let response = try await call(target, method: "POST", body: ["fields": FirestoreCodec.wrap(values)], bearer: session.idToken)
        if response.0 != 409 { _ = try checked(response, "No se pudo guardar la reserva.") }
    }

    func reservationStatus(_ id: String) async throws -> Reservation? {
        let session = try await activeSession()
        let response = try await call(firebaseURL("reservation_status/\(id)"), bearer: session.idToken)
        if response.0 == 404 { return nil }
        let payload = try checked(response, "No se pudo consultar la reserva.")
        return parseReservation(FirestoreCodec.fields(payload["fields"] as? [String: Any] ?? [:]))
    }

    func myReservations() async throws -> [Reservation] {
        let session = try await activeSession()
        var output: [Reservation] = []
        let query: [String: Any] = [
            "from": [["collectionId": "reservation_status"]],
            "where": ["fieldFilter": ["field": ["fieldPath": "ownerUid"], "op": "EQUAL", "value": ["stringValue": session.uid]]],
            "limit": 1000,
        ]
        let response = try await call(url("\(RestBluConfig.firestore.absoluteString):runQuery", [URLQueryItem(name: "key", value: RestBluConfig.firebaseAPIKey)]),
                                      method: "POST", body: ["structuredQuery": query], bearer: session.idToken)
        guard (200...299).contains(response.0) else { throw RestBluError.message("No se pudieron cargar tus reservas.") }
        for row in response.1 as? [[String: Any]] ?? [] {
            guard let document = row["document"] as? [String: Any] else { continue }
            let fields = FirestoreCodec.fields(document["fields"] as? [String: Any] ?? [:])
            if let reservation = parseReservation(fields) { output.append(reservation) }
        }
        return output.sorted { $0.createdAt > $1.createdAt }
    }

    private func parseReservation(_ fields: [String: Any]) -> Reservation? {
        guard let booking = fields["booking"] as? [String: Any], !booking.text("id").isEmpty else { return nil }
        let verified = fields.bool("verified") && fields.text("paymentStatus") == "aprobado-demo"
        return Reservation(id: booking.text("id"), propertyID: booking.int("propertyId"), propertyName: booking.text("propertyName"),
                           propertyPlace: booking.text("propertyPlace"), propertyImage: "", guestName: booking.text("guestName"),
                           documentID: booking.text("documentId"), email: booking.text("email"), phone: booking.text("phone"),
                           checkIn: booking.text("checkIn"), checkOut: booking.text("checkOut"), guests: booking.int("guests"),
                           nights: booking.int("nights"), nightlyPrice: booking.int("nightlyPrice"), total: booking.int("total"),
                           accessPIN: verified ? booking.text("accessPin") : "", createdAt: booking.text("createdAt"),
                           status: fields.text("status"), paymentStatus: fields.text("paymentStatus"), verified: verified,
                           emailVerified: fields.bool("emailVerified"), biometricStatus: fields.text("biometricStatus"),
                           dahuaQRStatus: fields.text("dahuaQrStatus"),
                           accessQRImage: verified ? fields.text("accessQrImage").components(separatedBy: "base64,").last ?? "" : "",
                           accessQRExpiresAt: verified ? fields.text("accessQrExpiresAt") : "",
                           pdfBase64: fields.text("pdfBase64"), pdfFileName: fields.text("pdfFileName"), error: fields.text("error"))
    }

    func createBridge(_ collection: String, _ values: [String: Any], fixedID: String? = nil) async throws -> String {
        let session = try await activeSession()
        let id = fixedID ?? UUID().uuidString.lowercased()
        var input = values
        input["ownerUid"] = session.uid
        input["syncStatus"] = "pending"
        input["createdAt"] = ISO8601DateFormatter().string(from: Date())
        let target = try firebaseURL(collection, [URLQueryItem(name: "documentId", value: id)])
        let result = try await call(target, method: "POST", body: ["fields": FirestoreCodec.wrap(input)], bearer: session.idToken)
        if result.0 != 409 || fixedID == nil { _ = try checked(result, "Firebase no pudo recibir la solicitud.") }
        return id
    }

    func awaitBridge(_ collection: String, _ id: String, interval: UInt64 = 2_500_000_000) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline {
            try await Task.sleep(nanoseconds: interval)
            let session = try await activeSession()
            let payload = try checked(await call(firebaseURL("\(collection)/\(id)"), bearer: session.idToken), "No se pudo consultar al gestor.")
            let fields = FirestoreCodec.fields(payload["fields"] as? [String: Any] ?? [:])
            if fields.text("syncStatus") == "processed" { return fields }
            if fields.text("syncStatus") == "error" { throw RestBluError.message(fields.text("error").isEmpty ? "El gestor rechazó la solicitud." : fields.text("error")) }
        }
        throw RestBluError.message("El gestor aún no responde. La solicitud quedó en espera.")
    }
}

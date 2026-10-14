import SwiftUI
import UIKit

struct ReservationsView: View {
    @EnvironmentObject private var store: RestBluStore

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if store.account == nil {
                    ContentUnavailableView("Inicia sesión", systemImage: "person.crop.circle",
                                           description: Text("Tus reservas aparecen al ingresar con tu cuenta RestBlu."))
                } else if store.account?.emailVerified != true {
                    ContentUnavailableView("Verifica tu correo", systemImage: "envelope.badge",
                                           description: Text("Abre Perfil e ingresa el código de seis dígitos."))
                } else if store.reservations.isEmpty {
                    ContentUnavailableView("Aún no tienes reservas", systemImage: "calendar.badge.plus")
                }
                ForEach(store.reservations) { reservation in
                    NavigationLink(value: reservation.id) {
                        RestBluCard {
                            Text(reservation.propertyName).font(.title3.bold()).foregroundStyle(Brand.navy)
                            Text(reservation.propertyPlace).foregroundStyle(.secondary)
                            Text("\(reservation.checkIn) → \(reservation.checkOut) · \(reservation.guests) huéspedes")
                            Text(RestBluFormat.currency(reservation.total)).font(.headline)
                            Label(reservation.verified ? "Estadía confirmada" : reservation.paymentStatus == "reembolso-pendiente" ? "Reembolso pendiente" : reservation.status.isEmpty ? "En proceso" : reservation.status,
                                  systemImage: reservation.verified ? "checkmark.seal.fill" : "clock")
                                .foregroundStyle(reservation.verified ? .green : Brand.teal)
                        }
                    }.buttonStyle(.plain)
                }
            }.padding()
        }
        .background(Brand.pale)
        .navigationTitle("Mis reservas")
        .navigationDestination(for: String.self) { ReservationDetailView(reservationID: $0) }
        .refreshable { await store.refreshReservations() }
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Button("Actualizar", systemImage: "arrow.clockwise") { Task { await store.refreshReservations() } }
        } }
    }
}

struct ReservationDetailView: View {
    let reservationID: String
    @EnvironmentObject private var store: RestBluStore
    @State private var showingFace = false

    private var reservation: Reservation? { store.reservations.first { $0.id == reservationID } }

    var body: some View {
        ScrollView {
            if let reservation {
                VStack(alignment: .leading, spacing: 16) {
                    RestBluCard {
                        Text(reservation.propertyName).font(.title2.bold()).foregroundStyle(Brand.navy)
                        Text(reservation.propertyPlace)
                        Text("\(reservation.checkIn) → \(reservation.checkOut)")
                        Text("\(reservation.guests) huéspedes · \(reservation.nights) noches")
                        Text(RestBluFormat.currency(reservation.total)).font(.headline)
                    }
                    RestBluCard {
                        LabeledContent("Código", value: reservation.id)
                        LabeledContent("Estado", value: reservation.status.isEmpty ? "Procesando" : reservation.status)
                        LabeledContent("Correo", value: reservation.emailVerified ? "Verificado" : "Pendiente")
                        LabeledContent("Pago", value: reservation.paymentStatus)
                        if !reservation.error.isEmpty { Text(reservation.error).foregroundStyle(.red) }
                    }
                    if !reservation.verified && reservation.paymentStatus != "reembolso-pendiente" && reservation.status != "expirada" {
                        Button("Pagar con Webpay") { Task { await store.beginPayment(reservation) } }
                            .buttonStyle(.borderedProminent).tint(Brand.teal)
                            .disabled(!reservation.emailVerified || store.busy)
                        Text("Paga una sola vez. Si cierras Webpay, actualiza esta reserva para confirmar el resultado.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if reservation.verified {
                        RestBluCard {
                            Text("Acceso").font(.headline)
                            if reservation.dahuaQRStatus == "activo", let bytes = Data(base64Encoded: reservation.accessQRImage),
                               let image = UIImage(data: bytes) {
                                Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                                    .frame(maxWidth: 240).frame(maxWidth: .infinity)
                                    .accessibilityLabel("Código QR de acceso")
                                Text("QR válido hasta \(reservation.accessQRExpiresAt)").font(.footnote)
                            } else { Text("El gestor está preparando tu QR de acceso.").foregroundStyle(.secondary) }
                            if !reservation.accessPIN.isEmpty { LabeledContent("PIN temporal", value: reservation.accessPIN) }
                            LabeledContent("Biometría facial", value: reservation.biometricStatus)
                            if reservation.biometricStatus != "activa" {
                                Button("Registrar rostro") { showingFace = true }
                            }
                        }
                        if let file = ReservationDocument.url(for: reservation) {
                            ShareLink(item: file) { Label("Compartir comprobante PDF", systemImage: "square.and.arrow.up") }
                        }
                    }
                    Button("Consultar estado") { Task { await store.refreshReservation(reservation.id) } }
                        .disabled(store.busy)
                }.padding()
            } else {
                ContentUnavailableView("Reserva no disponible", systemImage: "calendar.badge.exclamationmark")
            }
        }
        .background(Brand.pale)
        .navigationTitle("Detalle de reserva")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingFace) {
            if let reservation { FaceEnrollmentView(reservation: reservation) }
        }
    }
}

enum ReservationDocument {
    static func url(for reservation: Reservation) -> URL? {
        guard let bytes = Data(base64Encoded: reservation.pdfBase64), !bytes.isEmpty else { return nil }
        let name = reservation.pdfFileName.isEmpty ? "RestBlu-\(reservation.id).pdf" : reservation.pdfFileName
        let safe = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: "\\", with: "-")
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
        do { try bytes.write(to: file, options: .atomic); return file }
        catch { return nil }
    }
}

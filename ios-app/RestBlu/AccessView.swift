import SwiftUI

struct AccessView: View {
    @EnvironmentObject private var store: RestBluStore

    private var eligible: [Reservation] { store.reservations.filter { $0.verified } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if eligible.isEmpty {
                    ContentUnavailableView("Sin accesos activos", systemImage: "key.horizontal",
                                           description: Text("El QR y la apertura se habilitan cuando se confirma una reserva pagada."))
                }
                ForEach(eligible) { reservation in
                    RestBluCard {
                        Text(reservation.propertyName).font(.title3.bold()).foregroundStyle(Brand.navy)
                        Text("\(reservation.checkIn) → \(reservation.checkOut)")
                        if reservation.dahuaQRStatus == "activo", let bytes = Data(base64Encoded: reservation.accessQRImage),
                           let image = UIImage(data: bytes) {
                            Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                                .frame(maxWidth: 250).frame(maxWidth: .infinity)
                                .accessibilityLabel("QR de acceso para \(reservation.propertyName)")
                            Text("Válido hasta \(reservation.accessQRExpiresAt)").font(.footnote)
                        } else {
                            Text("QR en preparación. Desliza para actualizar.").foregroundStyle(.secondary)
                        }
                        if !reservation.accessPIN.isEmpty {
                            LabeledContent("PIN", value: reservation.accessPIN)
                        }
                        Button("Abrir con Face ID o Touch ID") {
                            Task { await store.openDoor(reservation, biometric: true) }
                        }
                        .buttonStyle(.borderedProminent).tint(Brand.teal)
                        .disabled(store.busy || reservation.dahuaQRStatus != "activo")
                        Button("Solicitar apertura") { Task { await store.openDoor(reservation, biometric: false) } }
                            .disabled(store.busy || reservation.dahuaQRStatus != "activo")
                    }
                }
            }.padding()
        }
        .background(Brand.pale)
        .navigationTitle("Acceso")
        .refreshable { await store.refreshReservations() }
    }
}

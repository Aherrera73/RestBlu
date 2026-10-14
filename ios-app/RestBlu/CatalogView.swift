import SwiftUI

struct CatalogView: View {
    @EnvironmentObject private var store: RestBluStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 7) {
                    Text("RESTBLU").font(.caption.bold()).tracking(3).foregroundStyle(.mint)
                    Text("Tu próxima estadía empieza aquí")
                        .font(.largeTitle.bold()).foregroundStyle(.white)
                    Text("Busca, reserva y accede desde tu iPhone.")
                        .foregroundStyle(.white.opacity(0.8))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
                .background(Brand.navy, in: RoundedRectangle(cornerRadius: 24))

                RestBluCard {
                    TextField("Destino o alojamiento", text: $store.query)
                        .textInputAutocapitalization(.words)
                        .accessibilityLabel("Buscar destino o alojamiento")
                    DatePicker("Llegada", selection: $store.checkIn, in: Date()..., displayedComponents: .date)
                    DatePicker("Salida", selection: $store.checkOut, in: store.checkIn..., displayedComponents: .date)
                    Stepper("\(store.guests) huéspedes", value: $store.guests, in: 1...20)
                }
                Text("\(store.filteredProperties.count) alojamientos disponibles")
                    .font(.headline).foregroundStyle(Brand.navy)
                if store.properties.isEmpty {
                    ContentUnavailableView("Sin alojamientos", systemImage: "wifi.slash",
                                           description: Text("Comprueba tu conexión e intenta actualizar."))
                    Button("Actualizar") { Task { await store.loadCatalog() } }
                }
                ForEach(store.filteredProperties) { property in
                    NavigationLink(value: property) {
                        VStack(alignment: .leading, spacing: 0) {
                            RemoteImage(address: property.image)
                            VStack(alignment: .leading, spacing: 7) {
                                Text(property.name).font(.title3.bold()).foregroundStyle(Brand.navy)
                                Text("\(property.place) · hasta \(property.guests) huéspedes")
                                    .foregroundStyle(.secondary)
                                Text("\(RestBluFormat.currency(property.nightlyPrice)) / noche")
                                    .font(.headline).foregroundStyle(Brand.teal)
                            }.padding(15)
                        }
                        .background(.white, in: RoundedRectangle(cornerRadius: 20))
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                    }
                    .buttonStyle(.plain)
                }
            }.padding()
        }
        .background(Brand.pale)
        .navigationTitle("Alojamientos")
        .navigationDestination(for: Property.self) { PropertyDetailView(property: $0) }
        .refreshable { await store.loadCatalog() }
    }
}

struct PropertyDetailView: View {
    let property: Property
    @EnvironmentObject private var store: RestBluStore
    @State private var showingBooking = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TabView {
                    ForEach([property.image] + property.gallery, id: \.self) { source in
                        RemoteImage(address: source, height: 280)
                    }
                }
                .tabViewStyle(.page)
                .frame(height: 280)
                VStack(alignment: .leading, spacing: 13) {
                    Text(property.name).font(.largeTitle.bold()).foregroundStyle(Brand.navy)
                    Label(property.place, systemImage: "mappin")
                    Text("\(property.type) · \(property.guests) huéspedes · \(property.beds) camas · \(property.baths) baños")
                        .foregroundStyle(.secondary)
                    if !property.tags.isEmpty { Text(property.tags.joined(separator: " · ")).font(.subheadline) }
                    Divider()
                    DatePicker("Llegada", selection: $store.checkIn, in: Date()..., displayedComponents: .date)
                    DatePicker("Salida", selection: $store.checkOut, in: store.checkIn..., displayedComponents: .date)
                    Stepper("\(store.guests) huéspedes", value: $store.guests, in: 1...max(1, property.guests))
                    let nights = max(0, RestBluFormat.nights(store.checkIn, store.checkOut))
                    Text("\(nights) noches · \(RestBluFormat.currency(property.nightlyPrice * nights))")
                        .font(.headline).foregroundStyle(Brand.teal)
                    Button("Reservar alojamiento") { showingBooking = true }
                        .buttonStyle(.borderedProminent)
                        .tint(Brand.teal)
                        .disabled(nights == 0 || !RestBluFormat.available(property, from: store.checkIn, to: store.checkOut))
                }.padding()
            }
        }
        .navigationTitle("Detalle")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingBooking) { BookingView(property: property) }
    }
}

struct BookingView: View {
    let property: Property
    @EnvironmentObject private var store: RestBluStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var phone = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Estadía") {
                    Text(property.name)
                    Text("\(RestBluFormat.date(store.checkIn)) → \(RestBluFormat.date(store.checkOut))")
                    Text(RestBluFormat.currency(property.nightlyPrice * RestBluFormat.nights(store.checkIn, store.checkOut)))
                }
                Section("Huésped") {
                    TextField("Nombre completo", text: $name)
                    Text("RUT: \(store.profile.documentID.isEmpty ? "Completa tu perfil" : store.profile.documentID)")
                    Text("Correo: \(store.account?.email ?? "Inicia sesión")")
                    TextField("Teléfono", text: $phone).keyboardType(.phonePad)
                }
                Section {
                    Button("Enviar reserva") {
                        Task { if await store.book(property, name: name, phone: phone) { dismiss() } }
                    }
                    .disabled(store.busy || store.account?.emailVerified != true)
                } footer: {
                    Text("La reserva debe procesarse en el gestor antes de iniciar Webpay. El acceso se habilita después de confirmar pago y correo.")
                }
            }
            .navigationTitle("Confirmar reserva")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cerrar") { dismiss() } } }
            .onAppear { name = store.profile.name; phone = store.profile.phone }
        }
    }
}

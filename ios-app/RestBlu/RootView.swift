import SwiftUI

enum Brand {
    static let navy = Color(red: 0.05, green: 0.17, blue: 0.25)
    static let teal = Color(red: 0.02, green: 0.42, blue: 0.45)
    static let pale = Color(red: 0.92, green: 0.97, blue: 0.97)
}

struct RootView: View {
    @EnvironmentObject private var store: RestBluStore
    @Environment(\.openURL) private var openURL
    @State private var showingNotice = false

    var body: some View {
        TabView {
            NavigationStack { CatalogView() }
                .tabItem { Label("Inicio", systemImage: "house") }
            NavigationStack { ReservationsView() }
                .tabItem { Label("Reservas", systemImage: "calendar") }
            NavigationStack { AccessView() }
                .tabItem { Label("Acceso", systemImage: "key") }
            NavigationStack { BluView() }
                .tabItem { Label("Blu IA", systemImage: "sparkles") }
            NavigationStack { ProfileView() }
                .tabItem { Label("Perfil", systemImage: "person.crop.circle") }
        }
        .tint(Brand.teal)
        .onChange(of: store.notice) { showingNotice = !$0.isEmpty }
        .alert("RestBlu", isPresented: $showingNotice) {
            Button("Entendido") { store.notice = "" }
        } message: { Text(store.notice) }
        .onChange(of: store.paymentURL) { value in
            if let value { openURL(value); store.paymentURL = nil }
        }
    }
}

struct RemoteImage: View {
    let address: String
    var height: CGFloat = 190

    var body: some View {
        AsyncImage(url: URL(string: address)) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFill()
            default:
                ZStack {
                    Brand.pale
                    Image(systemName: "house.fill").font(.largeTitle).foregroundStyle(Brand.teal)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipped()
    }
}

struct RestBluCard<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Brand.teal.opacity(0.12)))
    }
}

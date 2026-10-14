import SwiftUI

@main
struct RestBluApp: App {
    @StateObject private var store = RestBluStore()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .task { await store.start() }
                .onOpenURL { link in Task { await store.handlePaymentReturn(link) } }
                .onChange(of: phase) { newPhase in
                    if newPhase == .active { Task { await store.resumePayments() } }
                }
        }
    }
}

import SwiftUI

@main
struct WYXNetApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Group {
                if model.loggedIn { MainView() } else { LoginView() }
            }
            .environmentObject(model)
            .task { await model.bootstrap() }
            .onChange(of: phase) { _, p in
                if p == .active, model.loggedIn {
                    Task { await model.refreshProfile(force: false); await model.uploadEvents() }
                }
            }
        }
    }
}

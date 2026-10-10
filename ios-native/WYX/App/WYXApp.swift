import SwiftUI

/// Состояние сессии: вошли или нет, кто я.
@MainActor
final class Session: ObservableObject {
    @Published var loggedIn = API.shared.isLoggedIn
    @Published var me: Profile?
    @Published var openChat: Chat?

    func start() async {
        // Для автоматических прогонов (симулятор): SIMCTL_CHILD_WYX_USER / WYX_PASS.
        let env = ProcessInfo.processInfo.environment
        if !loggedIn, let u = env["WYX_USER"], let p = env["WYX_PASS"] {
            try? await API.shared.login(username: u, password: p)
            loggedIn = API.shared.isLoggedIn
        }
        guard loggedIn else { return }
        if let p = try? await API.shared.currentProfile() { me = p } else if !API.shared.isLoggedIn { loggedIn = false }
        if env["WYX_OPEN"] == "saved", let c = try? await API.shared.savedChat() { openChat = c }
    }

    func logout() { API.shared.logout(); loggedIn = false; me = nil }
}

@main
struct WYXApp: App {
    @StateObject private var session = Session()
    var body: some Scene {
        WindowGroup {
            Group {
                if session.loggedIn { RootView() } else { AuthView() }
            }
            .environmentObject(session)
            .task { await session.start() }
        }
    }
}

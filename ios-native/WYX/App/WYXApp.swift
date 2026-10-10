import SwiftUI
import Combine

/// Состояние сессии: вошли или нет, кто я, сокет, непрочитанные.
@MainActor
final class Session: ObservableObject {
    @Published var loggedIn = API.shared.isLoggedIn
    @Published var me: Profile?
    @Published var openChat: Chat?
    @Published var unread: [String: Int] = [:]
    @Published var online: [String: Bool] = [:]
    /// Растёт при событиях, после которых список чатов стоит перечитать.
    @Published var chatsVersion = 0
    let socket = Socket()
    private var bag = Set<AnyCancellable>()

    init() {
        socket.events.sink { [weak self] e in self?.handle(e) }.store(in: &bag)
    }

    func start() async {
        // Для автоматических прогонов (симулятор): SIMCTL_CHILD_WYX_USER / WYX_PASS.
        let env = ProcessInfo.processInfo.environment
        if !loggedIn, let u = env["WYX_USER"], let p = env["WYX_PASS"] {
            try? await API.shared.login(username: u, password: p)
            loggedIn = API.shared.isLoggedIn
        }
        guard loggedIn else { return }
        if let p = try? await API.shared.currentProfile() { me = p } else if !API.shared.isLoggedIn { loggedIn = false; return }
        if let me { socket.connect(userId: me.id) }
        await refreshUnread()
        if env["WYX_OPEN"] == "saved", let c = try? await API.shared.savedChat() { openChat = c }
    }

    func refreshUnread() async {
        if let u = try? await API.shared.unreadCount() { unread = u.unread_by_chat }
    }

    func logout() { socket.disconnect(); API.shared.logout(); loggedIn = false; me = nil }

    private func handle(_ e: [String: Any]) {
        let data = e["data"] as? [String: Any] ?? [:]
        let type = (data["type"] as? String) ?? (e["type"] as? String) ?? ""
        switch type {
        case "new_message":
            chatsVersion += 1
            Task { await refreshUnread() }
        case "presence":
            if let pid = data["profile_id"] { online[String(describing: pid)] = (data["online"] as? Bool) ?? (data["online"] as? Int == 1) }
        case "read":
            chatsVersion += 1
        case "rov":
            // Р.Ё.В: собеседник держит палец — у нас вибрирует, пока держит.
            if (data["on"] as? Bool) == true { Rov.shared.start() } else { Rov.shared.stop() }
        default: break
        }
    }
}

/// Непрерывная вибрация, пока Р.Ё.В включён с той стороны.
@MainActor
final class Rov {
    static let shared = Rov()
    private var task: Task<Void, Never>?
    func start() {
        guard task == nil else { return }
        task = Task {
            let gen = UIImpactFeedbackGenerator(style: .heavy); gen.prepare()
            while !Task.isCancelled { gen.impactOccurred(); try? await Task.sleep(for: .milliseconds(120)) }
        }
    }
    func stop() { task?.cancel(); task = nil }
}

@main
struct WYXApp: App {
    @StateObject private var session = Session()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            Group {
                if session.loggedIn { RootView() } else { AuthView() }
            }
            .environmentObject(session)
            .task { await session.start() }
            .onChange(of: phase) { _, p in
                session.socket.send(["type": "active", "active": p == .active])
                if p == .active, session.loggedIn, !session.socket.connected, let me = session.me { session.socket.connect(userId: me.id) }
            }
        }
    }
}

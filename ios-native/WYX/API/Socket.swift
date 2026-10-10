import Foundation
import Combine

/// Пользовательский сокет /ws/user/<id>/?token=… — как WebSocketService в вебе:
/// новые сообщения, прочтение, присутствие, реакции, Р.Ё.В, звонки.
/// События отдаются как словари, разбор — у подписчиков.
@MainActor
final class Socket: ObservableObject {
    let events = PassthroughSubject<[String: Any], Never>()
    @Published private(set) var connected = false

    private var task: URLSessionWebSocketTask?
    private var userId: String?
    private var attempts = 0
    private var pinger: Task<Void, Never>?
    private var closedByUs = false

    func connect(userId: String) {
        self.userId = userId
        closedByUs = false
        open()
    }

    func disconnect() {
        closedByUs = true
        pinger?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connected = false
    }

    func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
        task?.send(.string(s)) { _ in }
    }

    private func open() {
        guard let userId, let token = API.shared.access else { return }
        var comps = URLComponents(url: API.shared.wsBase.appendingPathComponent("user/\(userId)/"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "token", value: token)]
        let t = URLSession.shared.webSocketTask(with: comps.url!)
        task = t
        t.resume()
        connected = true
        attempts = 0
        send(["type": "active", "active": true])
        receive()
        pinger?.cancel()
        pinger = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(25))
                self?.send(["type": "ping"])
            }
        }
    }

    private func receive() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let msg):
                    if case .string(let s) = msg, let d = s.data(using: .utf8),
                       let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
                        if (obj["type"] as? String) != "pong" { self.events.send(obj) }
                    }
                    self.receive()
                case .failure:
                    self.connected = false
                    guard !self.closedByUs else { return }
                    // Переподключение с нарастающей паузой, не больше 20 с.
                    self.attempts += 1
                    let delay = min(20, pow(1.6, Double(self.attempts)))
                    try? await Task.sleep(for: .seconds(delay))
                    if !self.closedByUs { self.open() }
                }
            }
        }
    }
}

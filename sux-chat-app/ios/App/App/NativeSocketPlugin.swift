import Foundation
import Capacitor

/// Сокет пользователя в процессе приложения (src/lib/nativeSocket.ts).
///
/// WebSocket страницы живёт в процессах WebKit, а их система усыпляет, как
/// только приложение уходит с экрана. Звонок, принятый с экрана CallKit, не
/// мог отправить call_accept: сокет страницы умер, новый не открывался, пока
/// человек не зайдёт в приложение, — и звука не было ни с одной стороны.
/// Процесс приложения во время звонка работает (CallKit, фоновое аудио), сокет
/// здесь живёт вместе с ним, а каждое событие будит страницу.
///
/// Соединений может быть несколько: id выдаёт страница, события помечены им.
@objc(NativeSocketPlugin)
public class NativeSocketPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionWebSocketDelegate {
    public let identifier = "NativeSocketPlugin"
    public let jsName = "NativeSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]

    private final class Conn {
        let task: URLSessionWebSocketTask
        var open = false
        var timer: DispatchSourceTimer?
        init(task: URLSessionWebSocketTask) { self.task = task }
    }

    /// Соединения и сессия — только на этой очереди (на ней же и делегат).
    private let q = DispatchQueue(label: "com.hyax.native-socket")
    private var conns: [String: Conn] = [:]
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.default
        // Тишина между сообщениями для сокета — норма, живость проверяет ping.
        cfg.timeoutIntervalForRequest = 3600
        cfg.waitsForConnectivity = false
        let ops = OperationQueue()
        ops.maxConcurrentOperationCount = 1
        ops.underlyingQueue = q
        return URLSession(configuration: cfg, delegate: self, delegateQueue: ops)
    }()

    @objc func connect(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let s = call.getString("url"), let url = URL(string: s) else {
            call.reject("id и url обязательны")
            return
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3600
        // Те же заголовки, что у сокета страницы: сервер и журналы видят одно приложение.
        if let origin = call.getString("origin"), !origin.isEmpty { req.setValue(origin, forHTTPHeaderField: "Origin") }
        if let ua = call.getString("userAgent"), !ua.isEmpty { req.setValue(ua, forHTTPHeaderField: "User-Agent") }
        q.async {
            if let old = self.conns[id] { self.drop(id, old, code: 1000, notify: false) }
            let task = self.session.webSocketTask(with: req)
            task.maximumMessageSize = 16 << 20
            task.taskDescription = id
            let c = Conn(task: task)
            self.conns[id] = c
            task.resume()
            self.receive(id, c)
            // Рукопожатие не уложилось в 15 с — закрываем, страница переподключится.
            self.q.asyncAfter(deadline: .now() + 15) { [weak self] in
                guard let self, self.conns[id] === c, !c.open else { return }
                self.drop(id, c, code: 1006, notify: true)
            }
            call.resolve()
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let data = call.getString("data") else {
            call.reject("id и data обязательны")
            return
        }
        q.async {
            guard let c = self.conns[id], c.open else { call.reject("сокет не открыт"); return }
            c.task.send(.string(data)) { [weak self] err in
                guard err != nil, let self else { return }
                self.q.async { self.drop(id, c, code: 1006, notify: true) }
            }
            call.resolve()
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id обязателен"); return }
        q.async {
            if let c = self.conns[id] { self.drop(id, c, code: 1000, notify: true) }
            call.resolve()
        }
    }

    private func receive(_ id: String, _ c: Conn) {
        c.task.receive { [weak self] result in
            guard let self else { return }
            self.q.async {
                guard self.conns[id] === c else { return }
                switch result {
                case .success(let m):
                    var text: String?
                    switch m {
                    case .string(let s): text = s
                    case .data(let d): text = String(data: d, encoding: .utf8)
                    @unknown default: text = nil
                    }
                    if let text { self.notifyListeners("message", data: ["id": id, "data": text]) }
                    self.receive(id, c)
                case .failure(let e):
                    self.notifyListeners("error", data: ["id": id, "message": e.localizedDescription])
                    self.drop(id, c, code: NativeSocketPlugin.code(c.task), notify: true)
                }
            }
        }
    }

    /// Ping каждые 20 с: мёртвое соединение (смена сети, VPN режет простой)
    /// видно за полминуты, а не когда сервер наконец закроет его сам.
    private func startPing(_ id: String, _ c: Conn) {
        let t = DispatchSource.makeTimerSource(queue: q)
        t.schedule(deadline: .now() + 20, repeating: 20)
        t.setEventHandler { [weak self, weak c] in
            guard let self, let c, self.conns[id] === c else { return }
            var answered = false
            c.task.sendPing { [weak self] err in
                guard let self else { return }
                self.q.async {
                    answered = true
                    if err != nil { self.drop(id, c, code: 1006, notify: true) }
                }
            }
            self.q.asyncAfter(deadline: .now() + 10) { [weak self] in
                guard let self, !answered else { return }
                self.drop(id, c, code: 1006, notify: true)
            }
        }
        c.timer = t
        t.resume()
    }

    private func drop(_ id: String, _ c: Conn, code: Int, notify: Bool) {
        guard conns[id] === c else { return }
        conns[id] = nil
        c.timer?.cancel()
        c.timer = nil
        c.task.cancel(with: .normalClosure, reason: nil)
        if notify { notifyListeners("close", data: ["id": id, "code": code]) }
    }

    private static func code(_ task: URLSessionWebSocketTask) -> Int {
        let raw = task.closeCode.rawValue
        return raw == 0 ? 1006 : raw
    }

    // MARK: URLSessionWebSocketDelegate (на очереди q)

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard let id = webSocketTask.taskDescription, let c = conns[id], c.task === webSocketTask else { return }
        c.open = true
        startPing(id, c)
        notifyListeners("open", data: ["id": id])
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                           didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        guard let id = webSocketTask.taskDescription, let c = conns[id], c.task === webSocketTask else { return }
        drop(id, c, code: closeCode.rawValue, notify: true)
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription, let c = conns[id], c.task === task else { return }
        if let error { notifyListeners("error", data: ["id": id, "message": error.localizedDescription]) }
        drop(id, c, code: 1006, notify: true)
    }
}

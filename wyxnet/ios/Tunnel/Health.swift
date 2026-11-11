// Проверка связи через туннель: SOCKS5 к локальному входу Xray → HTTP-запрос на
// страницу «204». Трафик самого расширения туннель обходит, поэтому только через
// socks видно, что путь до сервера живой. Без TLS — дёшево и достаточно.
import Foundation
import Network

enum Health {
    struct Result { let ok: Bool; let ms: Int; let error: String? }

    static let targets: [(host: String, path: String)] = [
        ("connectivitycheck.gstatic.com", "/generate_204"),
        ("cp.cloudflare.com", "/"),
        ("www.google.com", "/generate_204"),
    ]

    static func probe(socksPort: Int, attempt: Int, timeout: TimeInterval = 8, completion: @escaping (Result) -> Void) {
        let target = targets[attempt % targets.count]
        let t0 = Date()
        let conn = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: UInt16(socksPort))!, using: .tcp)
        let q = DispatchQueue(label: "wyxnet.health")
        var finished = false
        func finish(_ ok: Bool, _ err: String?) {
            if finished { return }
            finished = true
            conn.cancel()
            completion(Result(ok: ok, ms: Int(Date().timeIntervalSince(t0) * 1000), error: err))
        }
        q.asyncAfter(deadline: .now() + timeout) { finish(false, "таймаут \(Int(timeout)) с (\(target.host))") }

        func recv(_ n: Int, _ then: @escaping (Data) -> Void) {
            conn.receive(minimumIncompleteLength: n, maximumLength: n) { data, _, _, err in
                if let err = err { finish(false, "socks: \(err)"); return }
                guard let d = data, d.count == n else { finish(false, "socks: соединение закрыто"); return }
                then(d)
            }
        }

        conn.stateUpdateHandler = { st in
            switch st {
            case .ready:
                conn.send(content: Data([0x05, 0x01, 0x00]), completion: .contentProcessed { _ in
                    recv(2) { d in
                        guard d[1] == 0x00 else { finish(false, "socks: метод отвергнут"); return }
                        var req = Data([0x05, 0x01, 0x00, 0x03, UInt8(target.host.utf8.count)])
                        req.append(contentsOf: Array(target.host.utf8))
                        req.append(contentsOf: [0x00, 0x50])
                        conn.send(content: req, completion: .contentProcessed { _ in
                            recv(4) { head in
                                guard head[1] == 0x00 else { finish(false, "socks: отказ \(head[1])"); return }
                                let rest: Int
                                switch head[3] { case 0x01: rest = 6; case 0x04: rest = 18; default: rest = -1 }
                                func sendHTTP() {
                                    let http = "GET \(target.path) HTTP/1.1\r\nHost: \(target.host)\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n"
                                    conn.send(content: Data(http.utf8), completion: .contentProcessed { _ in
                                        conn.receive(minimumIncompleteLength: 12, maximumLength: 4096) { data, _, _, err in
                                            if let err = err { finish(false, "http: \(err)"); return }
                                            let s = String(decoding: data ?? Data(), as: UTF8.self)
                                            if s.hasPrefix("HTTP/1.") , s.count >= 12, let code = Int(s[s.index(s.startIndex, offsetBy: 9)..<s.index(s.startIndex, offsetBy: 12)]), code < 500 {
                                                finish(true, nil)
                                            } else {
                                                finish(false, "http: \(s.prefix(40))")
                                            }
                                        }
                                    })
                                }
                                if rest > 0 { recv(rest) { _ in sendHTTP() } }
                                else { recv(1) { l in recv(Int(l[0]) + 2) { _ in sendHTTP() } } }
                            }
                        })
                    }
                })
            case .failed(let e): finish(false, "socks недоступен: \(e)")
            case .cancelled: finish(false, "отменено")
            default: break
            }
        }
        conn.start(queue: q)
    }
}

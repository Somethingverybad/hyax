// Обёртка над libXray: единственная функция CGoInvoke(JSON) → JSON {success, data, error}.
import Foundation

enum XrayCore {
    struct Reply { let ok: Bool; let data: Any?; let error: String }

    static func invoke(_ method: String, payload: [String: Any] = [:]) -> Reply {
        let req: [String: Any] = ["apiVersion": 3, "method": method, "payload": payload]
        guard let reqData = try? JSONSerialization.data(withJSONObject: req),
              let reqText = String(data: reqData, encoding: .utf8) else {
            return Reply(ok: false, data: nil, error: "запрос не сериализуется")
        }
        var out: String = ""
        reqText.withCString { cstr in
            guard let res = CGoInvoke(UnsafeMutablePointer(mutating: cstr)) else { return }
            out = String(cString: res)
            CGoFree(res)
        }
        guard let d = out.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else {
            return Reply(ok: false, data: nil, error: "ответ ядра не разобран: \(out.prefix(200))")
        }
        return Reply(ok: obj["success"] as? Bool ?? false, data: obj["data"], error: obj["error"] as? String ?? "")
    }

    /// Запустить ядро с конфигурацией; nil — успех, иначе текст ошибки.
    static func run(configJSON: String) -> String? {
        let r = invoke("runXray", payload: ["xrayJson": configJSON])
        return r.ok ? nil : (r.error.isEmpty ? "runXray: неизвестная ошибка" : r.error)
    }

    static func stop() {
        _ = invoke("stopXray")
    }

    static var isRunning: Bool {
        ((invoke("getXrayState").data as? [String: Any])?["running"] as? Bool) ?? false
    }

    static var version: String {
        ((invoke("xrayVersion").data as? [String: Any])?["version"] as? String) ?? "?"
    }
}

// Журнал для пользователя: одна строка на событие, в App Group, с обрезкой.
// Пишут и приложение (метка app), и расширение (метка tun); экран «Журнал» читает файл.
import Foundation
import os

final class TunnelLog {
    static let shared = TunnelLog()
    private let q = DispatchQueue(label: "wyxnet.log")
    private let maxBytes = 400 * 1024
    private let osLog = Logger(subsystem: "com.hyax.wyxnet", category: "tunnel")
    var tag = "app"

    private static let fmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "dd.MM HH:mm:ss"; f.locale = Locale(identifier: "ru_RU"); return f
    }()

    func log(_ message: String) {
        let line = "\(TunnelLog.fmt.string(from: Date())) [\(tag)] \(message)\n"
        osLog.info("\(message, privacy: .public)")
        q.async {
            let url = AppGroup.logURL
            let fm = FileManager.default
            if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
            if let h = try? FileHandle(forWritingTo: url) {
                _ = try? h.seekToEnd()
                try? h.write(contentsOf: Data(line.utf8))
                try? h.close()
            }
            if let size = (try? fm.attributesOfItem(atPath: url.path)[.size] as? Int), size > self.maxBytes,
               let d = try? Data(contentsOf: url) {
                // оставить хвост, с начала строки
                var tail = d.suffix(self.maxBytes / 2)
                if let nl = tail.firstIndex(of: 0x0A) { tail = tail[tail.index(after: nl)...] }
                try? Data(tail).write(to: url, options: .atomic)
            }
        }
    }

    func read() -> String {
        q.sync {
            (try? String(contentsOf: AppGroup.logURL, encoding: .utf8)) ?? ""
        }
    }

    func clear() {
        q.sync {
            try? Data().write(to: AppGroup.logURL)
            try? Data().write(to: AppGroup.xrayLogURL)
        }
    }
}

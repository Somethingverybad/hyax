// Общее для приложения и расширения туннеля: где лежат файлы в контейнере App Group.
// Приложение пишет profile.json (проверенный подписью список узлов) и settings.json,
// расширение — status.json (состояние раз в несколько секунд), tunnel.log и events.jsonl
// (отчёты для сервера, приложение их отправляет и подрезает файл).
import Foundation

enum AppGroup {
    static let id = "group.com.hyax.wyxnet"
    static let appBundleId = "com.hyax.wyxnet"
    static let tunnelBundleId = "com.hyax.wyxnet.tunnel"

    static var container: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id)
            ?? FileManager.default.temporaryDirectory
    }
    static var profileURL: URL { container.appendingPathComponent("profile.json") }
    static var settingsURL: URL { container.appendingPathComponent("settings.json") }
    static var statusURL: URL { container.appendingPathComponent("status.json") }
    static var logURL: URL { container.appendingPathComponent("tunnel.log") }
    static var xrayLogURL: URL { container.appendingPathComponent("xray.log") }
    static var eventsURL: URL { container.appendingPathComponent("events.jsonl") }
}

/// Настройки, которые читает расширение (приложение правит их в «Настройках»).
struct TunnelSettings: Codable, Equatable {
    /// Переключаться на другой узел, когда текущий перестал отвечать.
    var autoSwitch = true
    /// В простое менять узел, чтобы трафик не шёл всё время в одну точку.
    var rotateIdle = false
    /// Не раньше чем через столько минут на одном узле.
    var rotateMinutes = 60
    /// Узел, выбранный вручную (nil — автоматически, живые первыми).
    var preferredNode: String?

    static func load() -> TunnelSettings {
        guard let d = try? Data(contentsOf: AppGroup.settingsURL),
              let s = try? JSONDecoder().decode(TunnelSettings.self, from: d) else { return TunnelSettings() }
        return s
    }
    func save() {
        try? JSONEncoder().encode(self).write(to: AppGroup.settingsURL, options: .atomic)
    }
}

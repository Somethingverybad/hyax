import Foundation
import Capacitor

/// Принять то, что положило Share Extension (см. ShareExtension/ShareViewController.swift):
/// манифест и файлы лежат в общем контейнере App Group. `take` отдаёт список в
/// JS и убирает манифест, чтобы одно и то же не подставлялось дважды; `clear`
/// удаляет сами файлы, когда они уже отправлены.
@objc(ShareInboxPlugin)
public class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareInboxPlugin"
    public let jsName = "ShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    private var inbox: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.hyax.messenger")?
            .appendingPathComponent("inbox", isDirectory: true)
    }

    @objc func take(_ call: CAPPluginCall) {
        guard let inbox = inbox else { call.resolve(["items": [], "text": ""]); return }
        let manifest = inbox.appendingPathComponent("manifest.json")
        guard let data = try? Data(contentsOf: manifest),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            call.resolve(["items": [], "text": ""]); return
        }
        try? FileManager.default.removeItem(at: manifest)
        let items = (obj["items"] as? [[String: Any]] ?? []).compactMap { it -> [String: Any]? in
            guard let path = it["path"] as? String, FileManager.default.fileExists(atPath: path) else { return nil }
            return ["path": path, "name": it["name"] as? String ?? "file", "type": it["type"] as? String ?? "application/octet-stream"]
        }
        call.resolve(["items": items, "text": obj["text"] as? String ?? ""])
    }

    @objc func clear(_ call: CAPPluginCall) {
        if let inbox = inbox, let list = try? FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil) {
            list.forEach { try? FileManager.default.removeItem(at: $0) }
        }
        call.resolve()
    }
}

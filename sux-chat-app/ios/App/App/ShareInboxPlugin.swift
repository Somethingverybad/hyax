import Foundation
import Capacitor
import ImageIO
import UniformTypeIdentifiers

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
            var out: [String: Any] = ["path": path, "name": it["name"] as? String ?? "file", "type": it["type"] as? String ?? "application/octet-stream"]
            if let small = Self.downscaled(path: path, name: out["name"] as! String, type: out["type"] as! String) {
                out["path"] = small.path; out["name"] = small.name; out["type"] = "image/jpeg"
                out["scaledFrom"] = small.from
            }
            return out
        }
        call.resolve(["items": items, "text": obj["text"] as? String ?? ""])
    }

    /// Больше этого по длинной стороне фото веб-части не нужно: она всё равно
    /// ужимает до 1600 (lib/compressImage). А снимок с 48-Мп камеры она
    /// распаковывала целиком (createImageBitmap) — ~200 МБ в процессе WebView,
    /// и iOS мог его убить: белый экран после «Поделиться» (баг-репорт
    /// 4108eb14). ImageIO строит уменьшенную копию, не распаковывая оригинал.
    private static let maxSide = 2560

    private static func downscaled(path: String, name: String, type: String) -> (path: String, name: String, from: String)? {
        guard type.hasPrefix("image/"), type != "image/gif" else { return nil }
        let url = URL(fileURLWithPath: path)
        guard let src = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(src) == 1,
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
              let h = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
              max(w, h) > maxSide else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true, // поворот из EXIF
            kCGImageSourceThumbnailMaxPixelSize: maxSide,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        let dst = url.deletingPathExtension().appendingPathExtension("w\(maxSide).jpg")
        guard let out = CGImageDestinationCreateWithURL(dst as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(out, img, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
        guard CGImageDestinationFinalize(out) else { try? FileManager.default.removeItem(at: dst); return nil }
        try? FileManager.default.removeItem(at: url)
        let base = (name as NSString).deletingPathExtension
        return (dst.path, (base.isEmpty ? "photo" : base) + ".jpg", "\(w)x\(h)")
    }

    @objc func clear(_ call: CAPPluginCall) {
        if let inbox = inbox, let list = try? FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil) {
            list.forEach { try? FileManager.default.removeItem(at: $0) }
        }
        call.resolve()
    }
}

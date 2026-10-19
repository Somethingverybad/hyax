import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/// Загрузка своих треков в фоне (src/lib/trackUploads.ts).
///
/// `pick` — выбрать файлы или папку в «Файлах»; найденное аудио копируется в
/// Caches/music-upload, чтобы его можно было отправить и тогда, когда доступ к
/// выбранной папке уже закрыт. `upload` — отдать трек фоновой сессии
/// (MusicUploader): она продолжает при заблокированном экране и даже если iOS
/// выгрузит приложение. События — `picking` (выбор сделан, идёт копирование),
/// `progress`, `done`, `failed`; `list` — что ещё грузится и чем кончились
/// загрузки, пока интерфейса не было; `forget` — убрать записи и файлы.
@objc(MusicUploadPlugin)
public class MusicUploadPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "MusicUploadPlugin"
    public let jsName = "MusicUpload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "upload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
    ]

    /// Что принимает сервер (AUDIO_RE в backend/chat/views.py), без веб-форматов.
    static let audioExt: Set<String> = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"]

    private var pickCall: CAPPluginCall?
    private var pickFolder = false

    override public func load() {
        MusicUploader.shared.onEvent = { [weak self] name, data in
            self?.notifyListeners(name, data: data)
        }
        MusicUploader.shared.restore()
    }

    // MARK: выбор

    @objc func pick(_ call: CAPPluginCall) {
        let folder = call.getBool("folder") ?? false
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("Нет экрана"); return }
            self.pickCall?.resolve(["files": []])
            self.pickCall = call
            self.pickFolder = folder
            let picker: UIDocumentPickerViewController
            if folder {
                picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
            } else {
                let types: [UTType] = [.audio] + Self.audioExt.compactMap { UTType(filenameExtension: $0) }
                picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
                picker.allowsMultipleSelection = true
            }
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.resolve(["files": []])
        pickCall = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall else { return }
        pickCall = nil
        let folder = pickFolder
        notifyListeners("picking", data: ["count": urls.count])
        DispatchQueue.global(qos: .userInitiated).async {
            var out: [[String: Any]] = []
            for url in urls {
                if folder {
                    out += Self.collect(folder: url)
                } else if let f = Self.take(url, move: true) {
                    out.append(f)
                }
            }
            call.resolve(["files": out])
        }
    }

    /// Положить трек в нашу папку. Выбранное файлами система уже скопировала
    /// во временное место — переносим; из папки — копируем.
    static func take(_ src: URL, move: Bool) -> [String: Any]? {
        let ext = src.pathExtension.lowercased()
        let dst = MusicUploader.dir.appendingPathComponent("\(UUID().uuidString).\(ext)")
        let fm = FileManager.default
        if !(move && (try? fm.moveItem(at: src, to: dst)) != nil) {
            guard (try? fm.copyItem(at: src, to: dst)) != nil else { return nil }
        }
        let size = (try? dst.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return ["path": dst.path, "name": src.lastPathComponent, "size": size]
    }

    /// Всё аудио из папки и вложенных — по порядку имён (как лежит альбом).
    /// Файлы iCloud, которые ещё не скачаны на телефон, пропускаем.
    static func collect(folder: URL) -> [[String: Any]] {
        let scoped = folder.startAccessingSecurityScopedResource()
        defer { if scoped { folder.stopAccessingSecurityScopedResource() } }
        var out: [[String: Any]] = []
        var err: NSError?
        NSFileCoordinator().coordinate(readingItemAt: folder, options: [], error: &err) { dir in
            guard let en = FileManager.default.enumerator(
                at: dir, includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return }
            var found: [URL] = []
            for case let u as URL in en where audioExt.contains(u.pathExtension.lowercased()) {
                if (try? u.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true { found.append(u) }
            }
            found.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
            for u in found {
                if let f = take(u, move: false) { out.append(f) }
            }
        }
        if let err = err { NSLog("MusicUpload: папка недоступна: %@", err.localizedDescription) }
        return out
    }

    // MARK: загрузка

    /// Только файлы из нашей папки: после сборки запроса копия удаляется.
    private static func ours(_ path: String) -> Bool {
        let base = MusicUploader.dir.standardizedFileURL.path + "/"
        return URL(fileURLWithPath: path).standardizedFileURL.path.hasPrefix(base)
    }

    @objc func upload(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty, let path = call.getString("path"), Self.ours(path) else {
            call.reject("Нет файла")
            return
        }
        let fields = (call.getObject("fields") ?? [:]).compactMapValues { $0 as? String }
        MusicUploader.shared.upload(
            id: id, path: path, name: call.getString("name") ?? "track",
            urls: call.getArray("urls", String.self) ?? [], token: call.getString("token") ?? "",
            fields: fields, meta: call.getString("meta") ?? ""
        ) { err in
            if let err = err { call.reject(err) } else { call.resolve() }
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        MusicUploader.shared.list { call.resolve(["items": $0]) }
    }

    @objc func forget(_ call: CAPPluginCall) {
        MusicUploader.shared.forget(call.getArray("ids", String.self) ?? []) { call.resolve() }
    }
}

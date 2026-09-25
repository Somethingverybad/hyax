import UIKit
import UniformTypeIdentifiers

/// «Поделиться → WhoYaX» из Фото, Файлов, Safari и других приложений.
///
/// Расширение не может показать чат само: оно живёт отдельным процессом без
/// сессии и без нашего WebView. Поэтому оно только принимает вложения,
/// складывает их в общий контейнер App Group (`group.com.hyax.messenger`),
/// пишет манифест и открывает основное приложение по схеме `whoyax://share`.
/// Дальше всё делает само приложение: показывает выбор чата и подставляет
/// файлы в поле ввода (см. lib/shareInbox.ts и ShareInboxPlugin.swift).
final class ShareViewController: UIViewController {
    static let group = "group.com.hyax.messenger"

    private let spinner = UIActivityIndicatorView(style: .large)
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(white: 0.08, alpha: 0.96)
        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        label.text = "Отправляем в WhoYaX…"
        label.textColor = .white
        label.font = .systemFont(ofSize: 17, weight: .medium)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner); view.addSubview(label)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -16),
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 16),
        ])
        spinner.startAnimating()
        collect()
    }

    private struct Item { let path: String; let name: String; let type: String }

    private func collect() {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.group) else {
            finish(); return
        }
        let inbox = container.appendingPathComponent("inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        // Старое, что не забрали (приложение так и не открылось), выкидываем.
        (try? FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil))?.forEach { try? FileManager.default.removeItem(at: $0) }

        let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap { $0.attachments ?? [] } ?? []
        var items: [Item] = []
        var texts: [String] = []
        let group = DispatchGroup()
        let lock = NSLock()

        for p in providers {
            // Файл (фото, видео, документ) — копией в контейнер. Тип берём по
            // идентификатору, чтобы Фото отдали HEIC/JPEG как файл, а не как UIImage.
            let fileTypes = [UTType.movie, .image, .audio, .pdf, .data].map(\.identifier)
            if let t = fileTypes.first(where: { p.hasItemConformingToTypeIdentifier($0) }) {
                group.enter()
                p.loadFileRepresentation(forTypeIdentifier: t) { url, _ in
                    defer { group.leave() }
                    guard let url = url else { return }
                    let name = url.lastPathComponent.isEmpty ? "file" : url.lastPathComponent
                    let dst = inbox.appendingPathComponent("\(UUID().uuidString.prefix(8))-\(name)")
                    if (try? FileManager.default.copyItem(at: url, to: dst)) != nil {
                        let mime = UTType(filenameExtension: dst.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                        lock.lock(); items.append(Item(path: dst.path, name: name, type: mime)); lock.unlock()
                    }
                }
                continue
            }
            if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                group.enter()
                p.loadItem(forTypeIdentifier: UTType.url.identifier) { obj, _ in
                    defer { group.leave() }
                    if let u = obj as? URL { lock.lock(); texts.append(u.absoluteString); lock.unlock() }
                }
                continue
            }
            if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                group.enter()
                p.loadItem(forTypeIdentifier: UTType.plainText.identifier) { obj, _ in
                    defer { group.leave() }
                    if let s = obj as? String { lock.lock(); texts.append(s); lock.unlock() }
                    else if let d = obj as? Data, let s = String(data: d, encoding: .utf8) { lock.lock(); texts.append(s); lock.unlock() }
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self = self else { return }
            let manifest: [String: Any] = [
                "items": items.map { ["path": $0.path, "name": $0.name, "type": $0.type] },
                "text": texts.joined(separator: "\n"),
                "at": Date().timeIntervalSince1970 * 1000,
            ]
            if let data = try? JSONSerialization.data(withJSONObject: manifest) {
                try? data.write(to: inbox.appendingPathComponent("manifest.json"), options: .atomic)
            }
            self.openHostApp()
            // Даём системе кадр на запуск приложения, потом закрываемся.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.finish() }
        }
    }

    /// Расширению открывать приложения не положено, но UIApplication.open через
    /// цепочку responder'ов работает во всех версиях iOS — так делают все
    /// мессенджеры, у которых «поделиться» ведёт в само приложение.
    private func openHostApp() {
        guard let url = URL(string: "whoyax://share") else { return }
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = r.next
        }
        // Запасной путь: на некоторых версиях расширению дают открыть URL напрямую.
        extensionContext?.open(url, completionHandler: nil)
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}

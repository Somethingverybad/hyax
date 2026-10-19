import Foundation

/// Фоновая сессия загрузки треков (MusicUploadPlugin, src/lib/trackUploads.ts).
///
/// Фоновой сессией URLSession файлы отправляет сама система: загрузка идёт при
/// заблокированном экране и даже если iOS выгрузила приложение (закончилось —
/// система будит его ненадолго, см. AppDelegate). Тело запроса фоновая сессия
/// берёт только из файла, поэтому multipart собираем во временный файл: из
/// копии трека, которую потом удаляем. Этот же файл — источник для повтора
/// (метка client_id внутри него не меняется), его убираем, когда трек дошёл
/// или загрузку забыли.
///
/// Записи о загрузках лежат в UserDefaults: после перезапуска интерфейс
/// спрашивает `list` и видит, что ещё идёт и чем кончилось без него.
final class MusicUploader: NSObject, URLSessionDataDelegate {
    static let shared = MusicUploader()
    static let sessionId = "com.hyax.messenger.music-upload"

    struct Rec: Codable {
        var id: String
        var name: String
        var meta: String
        var body: String
        var boundary: String
        var urls: [String]
        var urlIndex: Int
        var attempts: Int
        var token: String
        var status: String   // uploading | done | failed
        var progress: Int
        var http: Int
        var error: String?
        var response: String?
    }

    /// Система разбудила приложение ради событий сессии — вызвать, когда всё разобрали.
    var backgroundCompletion: (() -> Void)?
    /// Событие в интерфейс: progress | done | failed.
    var onEvent: ((String, [String: Any]) -> Void)?

    private let ops: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        q.name = "music-upload"
        return q
    }()
    private var recs: [String: Rec] = [:]
    private var replies: [Int: Data] = [:]
    private var restored = false
    private let storeKey = "hyax.musicUpload.v1"

    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.background(withIdentifier: Self.sessionId)
        cfg.isDiscretionary = false
        cfg.sessionSendsLaunchEvents = true
        // По одному треку за раз: проценты идут по очереди, а не все сразу.
        cfg.httpMaximumConnectionsPerHost = 1
        cfg.timeoutIntervalForResource = 24 * 3600
        return URLSession(configuration: cfg, delegate: self, delegateQueue: ops)
    }()

    static var dir: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("music-upload", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    // MARK: состояние

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: storeKey),
              let list = try? JSONDecoder().decode([Rec].self, from: data) else { return }
        recs = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) })
    }

    private func save() {
        if let data = try? JSONEncoder().encode(Array(recs.values)) {
            UserDefaults.standard.set(data, forKey: storeKey)
        }
    }

    private func emit(_ name: String, _ r: Rec) {
        var d: [String: Any] = ["id": r.id, "status": r.status, "progress": r.progress, "http": r.http]
        if let e = r.error { d["error"] = e }
        if let resp = r.response { d["response"] = resp }
        let cb = onEvent
        DispatchQueue.main.async { cb?(name, d) }
    }

    /// При запуске: поднять записи и переподключиться к фоновой сессии. Загрузка,
    /// которую система потеряла (приложение смахнули — iOS снимает его задачи),
    /// помечается неудачной, интерфейс повторит её сам.
    func restore() {
        ops.addOperation {
            guard !self.restored else { return }
            self.restored = true
            self.load()
            self.session.getAllTasks { tasks in
                let live = Set(tasks.compactMap { $0.taskDescription })
                // Чуть подождать: события задач, закончившихся без нас, приходят
                // сразу после переподключения и важнее этой догадки.
                DispatchQueue.global().asyncAfter(deadline: .now() + 3) {
                    self.ops.addOperation {
                        for (id, r) in self.recs where r.status == "uploading" && !live.contains(id) {
                            self.finish(id, http: 0, error: nil, reply: nil, lost: true)
                        }
                    }
                }
            }
        }
    }

    // MARK: команды из плагина

    /// Поставить трек в загрузку. `path` — копия из `pick`; после сборки тела удаляется.
    func upload(id: String, path: String, name: String, urls: [String], token: String,
                fields: [String: String], meta: String, done: @escaping (String?) -> Void) {
        ops.addOperation {
            if !self.restored { self.restored = true; self.load() }
            if var r = self.recs[id] {
                if r.status == "done" { self.emit("done", r); done(nil); return }
                if r.status == "uploading" { done(nil); return }
                // Повтор: тело уже собрано, метка в нём та же — шлём его снова.
                if FileManager.default.fileExists(atPath: r.body) {
                    r.urls = urls; r.urlIndex = 0; r.attempts = 0; r.token = token
                    r.status = "uploading"; r.progress = 0; r.http = 0; r.error = nil
                    self.recs[id] = r
                    self.start(r)
                    done(nil)
                    return
                }
            }
            guard !urls.isEmpty else { done("Нет адреса загрузки"); return }
            let boundary = "wyx-" + UUID().uuidString
            let body = Self.dir.appendingPathComponent("\(id).body")
            do {
                try Self.writeBody(to: body, boundary: boundary, fields: fields,
                                   file: URL(fileURLWithPath: path), name: name)
            } catch {
                done("Файл недоступен — выберите его снова")
                return
            }
            try? FileManager.default.removeItem(atPath: path)
            let r = Rec(id: id, name: name, meta: meta, body: body.path, boundary: boundary,
                        urls: urls, urlIndex: 0, attempts: 0, token: token, status: "uploading",
                        progress: 0, http: 0, error: nil, response: nil)
            self.recs[id] = r
            self.start(r)
            done(nil)
        }
    }

    func list(_ done: @escaping ([[String: Any]]) -> Void) {
        ops.addOperation {
            if !self.restored { self.restored = true; self.load() }
            done(self.recs.values.map { r in
                var d: [String: Any] = ["id": r.id, "name": r.name, "meta": r.meta, "status": r.status,
                                        "progress": r.progress, "http": r.http]
                if let e = r.error { d["error"] = e }
                if let resp = r.response { d["response"] = resp }
                return d
            })
        }
    }

    /// Забыть загрузки: снять идущие задачи и убрать файлы.
    func forget(_ ids: [String], done: @escaping () -> Void) {
        ops.addOperation {
            let set = Set(ids)
            for id in ids {
                if let r = self.recs.removeValue(forKey: id) { try? FileManager.default.removeItem(atPath: r.body) }
            }
            self.save()
            self.session.getAllTasks { tasks in
                tasks.filter { set.contains($0.taskDescription ?? "") }.forEach { $0.cancel() }
                done()
            }
        }
    }

    // MARK: отправка

    private func start(_ r: Rec) {
        guard r.urlIndex < r.urls.count, let url = URL(string: r.urls[r.urlIndex]) else {
            finish(r.id, http: 0, error: "Нет адреса загрузки", reply: nil, lost: false)
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(r.boundary)", forHTTPHeaderField: "Content-Type")
        if !r.token.isEmpty { req.setValue("Bearer \(r.token)", forHTTPHeaderField: "Authorization") }
        let task = session.uploadTask(with: req, fromFile: URL(fileURLWithPath: r.body))
        task.taskDescription = r.id
        task.resume()
        save()
        emit("progress", r)
    }

    /// Задача кончилась: дошло — убрать тело; CDN не принял или оборвал — тот же
    /// запрос на прямой адрес; иначе — неудача, повторит интерфейс.
    private func finish(_ id: String, http: Int, error: String?, reply: Data?, lost: Bool) {
        guard var r = recs[id] else { return }
        let text = reply.flatMap { String(data: $0, encoding: .utf8) }
        if !lost && (200..<300).contains(http) {
            r.status = "done"; r.progress = 100; r.http = http; r.response = text; r.error = nil; r.token = ""
            try? FileManager.default.removeItem(atPath: r.body)
            recs[id] = r
            save()
            emit("done", r)
            return
        }
        let retryable = http == 0 || http == 408 || http == 413 || http >= 500
        if !lost && retryable && r.urlIndex + 1 < r.urls.count {
            r.urlIndex += 1; r.progress = 0
            recs[id] = r
            start(r)
            return
        }
        // Сеть оборвалась или сервер не ответил — ещё пару раз сами: фоновая
        // сессия начнёт новую попытку, когда сеть вернётся, и без интерфейса.
        if !lost && retryable && r.attempts < 3 {
            r.attempts += 1; r.progress = 0
            recs[id] = r
            start(r)
            return
        }
        var message = error
        if let reply = reply, let obj = try? JSONSerialization.jsonObject(with: reply) as? [String: Any],
           let e = obj["error"] as? String, !e.isEmpty { message = e }
        r.status = "failed"; r.http = http; r.error = message; r.progress = 0; r.token = ""
        recs[id] = r
        save()
        emit("failed", r)
    }

    // MARK: URLSessionDataDelegate

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let id = task.taskDescription, var r = recs[id], totalBytesExpectedToSend > 0 else { return }
        // 100 — только когда сервер ответил «принято».
        let p = min(99, Int(totalBytesSent * 100 / totalBytesExpectedToSend))
        guard p != r.progress else { return }
        r.progress = p
        recs[id] = r
        emit("progress", r)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        replies[dataTask.taskIdentifier, default: Data()].append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let reply = replies.removeValue(forKey: task.taskIdentifier)
        guard let id = task.taskDescription else { return }
        if let e = error as NSError?, e.code == NSURLErrorCancelled, recs[id] == nil { return }
        let http = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        finish(id, http: error == nil ? http : 0, error: error?.localizedDescription, reply: reply, lost: false)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletion?()
            self.backgroundCompletion = nil
        }
    }

    // MARK: тело запроса

    /// multipart/form-data: поля, затем файл "file" — кусками, без чтения целиком в память.
    static func writeBody(to target: URL, boundary: String, fields: [String: String], file: URL, name: String) throws {
        FileManager.default.createFile(atPath: target.path, contents: nil)
        let out = try FileHandle(forWritingTo: target)
        defer { try? out.close() }
        let input = try FileHandle(forReadingFrom: file)
        defer { try? input.close() }
        func put(_ s: String) { out.write(s.data(using: .utf8)!) }
        for (k, v) in fields {
            put("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(k)\"\r\n\r\n\(v)\r\n")
        }
        let safe = name.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
        put("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safe)\"\r\n")
        put("Content-Type: application/octet-stream\r\n\r\n")
        while true {
            let chunk = input.readData(ofLength: 1 << 20)
            if chunk.isEmpty { break }
            out.write(chunk)
        }
        put("\r\n--\(boundary)--\r\n")
    }
}

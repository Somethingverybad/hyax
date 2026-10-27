import Foundation
import Capacitor
import WebRTC
import AVFoundation
import UIKit

/// Медиа-слой звонков на нативном WebRTC.
///
/// Раньше разговор вёл WebView, и это не уживалось с CallKit: аудио-сессией
/// не могут владеть двое — микрофон движка молчал, пока звонок держала
/// система. Нативный движок работает с CallKit кооперативно (ручной режим
/// аудио: система активирует сессию — мы включаем звук), поэтому разговор
/// живёт при заблокированном экране, как в обычной телефонии.
///
/// Сигналинг и весь интерфейс остаются в вебе: сюда приходят только SDP и
/// ICE-кандидаты, обратно уходят события. Соединения хранятся по участнику,
/// поэтому групповой звонок (mesh) работает тем же кодом.
@objc(NativeCallPlugin)
public class NativeCallPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeCallPlugin"
    public let jsName = "NativeCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createPeer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createOffer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRemoteDescription", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addCandidate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closePeer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMuted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPeerVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flipCamera", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVideoLayout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAudioLevels", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getFeatures", returnType: CAPPluginReturnPromise),
    ]

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory())
    }()

    private var peers: [String: RTCPeerConnection] = [:]
    private var delegates: [String: PeerDelegate] = [:]
    // Входящие дорожки по участнику — для громкости каждого.
    private var remoteTracks: [String: RTCAudioTrack] = [:]
    private var peerVolumes: [String: Double] = [:]
    private var audioTrack: RTCAudioTrack?
    private var iceServers: [RTCIceServer] = []
    private let queue = DispatchQueue(label: "hyax.nativecall")

    // ── Видео (личные и групповые звонки) ────────────────────────────────
    // Видеоканал добавляется в соединение сразу (пустой) — камера потом
    // подставляется в него без пересогласования, как в веб-версии. Картинку
    // рисуют нативные окна под прозрачным WebView: кнопки звонка остаются
    // вёрсткой поверх видео, а их места страница сообщает через setVideoLayout.
    // Демонстрация экрана собеседника — второй видеоканал соединения, только
    // на приём (первый — камера). Его дорожка и окно — под ключом "id#screen".
    private var videoPeers = Set<String>()
    private var videoSource: RTCVideoSource?
    private var videoTrack: RTCVideoTrack?
    private var capturer: RTCCameraVideoCapturer?
    private var front = true
    private var remoteVideoTracks: [String: RTCVideoTrack] = [:]
    // Окно на каждого участника с видео и дорожка, к которой оно привязано
    // (только на главном потоке).
    private var remoteViews: [String: RTCMTLVideoView] = [:]
    private var viewTracks: [String: RTCVideoTrack] = [:]
    private var localView: RTCCameraPreviewView?
    private var webViewWasOpaque = true
    private var webViewBackground: UIColor?
    private var webScrollBackground: UIColor?
    /// Видео сейчас под страницей (WebView сделан прозрачным).
    private var layoutActive = false

    public override func load() {
        NativeCallAudio.shared.prepare()
    }

    // MARK: - Методы из JS

    /// Что умеет эта сборка: страница обновляется по воздуху и в старых
    /// сборках, новое она включает только по этому ответу.
    @objc func getFeatures(_ call: CAPPluginCall) {
        call.resolve(["screen": true])
    }

    @objc func start(_ call: CAPPluginCall) {
        let servers = call.getArray("iceServers", JSObject.self) ?? []
        iceServers = servers.compactMap { entry in
            let urls: [String]
            if let single = entry["urls"] as? String {
                urls = [single]
            } else if let many = entry["urls"] as? [String] {
                urls = many
            } else {
                return nil
            }
            if let user = entry["username"] as? String, let cred = entry["credential"] as? String {
                return RTCIceServer(urlStrings: urls, username: user, credential: cred)
            }
            return RTCIceServer(urlStrings: urls)
        }

        // Настройки → Микрофон (из JS): шумодав, эхоподавление и автогромкость
        // движка WebRTC. Системная обработка iOS (режим voiceChat) — поверх них.
        let mic = call.getObject("mic") ?? [:]
        let flag = { (key: String) -> String in (mic[key] as? Bool) == false ? "false" : "true" }
        let micConstraints = [
            "googNoiseSuppression": flag("noiseSuppression"),
            "googEchoCancellation": flag("echoCancellation"),
            "googAutoGainControl": flag("autoGainControl"),
        ]

        // Микрофон запрашиваем до соединения: без разрешения звонок
        // бессмысленен, а спрашивать посреди разговора поздно.
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            if !granted {
                call.reject("Нет доступа к микрофону")
                return
            }
            self.queue.async {
                CallDiag.log("start \(CallDiag.session())")
                NativeCallAudio.shared.beginCall()
                self.startDiag()
                if self.audioTrack == nil {
                    let constraints = RTCMediaConstraints(mandatoryConstraints: micConstraints, optionalConstraints: nil)
                    let source = NativeCallPlugin.factory.audioSource(with: constraints)
                    self.audioTrack = NativeCallPlugin.factory.audioTrack(with: source, trackId: "hyax-audio")
                }
                call.resolve()
            }
        }
    }

    @objc func createPeer(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else {
            call.reject("peerId обязателен")
            return
        }
        let video = call.getBool("video") ?? false
        let screen = call.getBool("screen") ?? false
        queue.async {
            if video { self.videoPeers.insert(peerId) }
            let pc = self.peer(for: peerId)
            // Звонящий с видео: пустой видеоканал сразу. Только здесь: у
            // отвечающего свой канал предложение не займёт (каналы из
            // addTransceiver не переиспользуются) — вышел бы лишний, и камера
            // с демонстрацией разъехались бы по номерам.
            if video && pc.transceivers.allSatisfy({ $0.mediaType != .video }) {
                let initVideo = RTCRtpTransceiverInit()
                initVideo.direction = .sendRecv
                initVideo.streamIds = ["hyax"]
                let t = pc.addTransceiver(of: .video, init: initVideo)
                if let track = self.videoTrack { t?.sender.track = track }
                // Собеседник умеет показывать экран — второй канал под демонстрацию.
                if screen {
                    let initScreen = RTCRtpTransceiverInit()
                    initScreen.direction = .recvOnly
                    _ = pc.addTransceiver(of: .video, init: initScreen)
                }
            }
            call.resolve()
        }
    }

    @objc func createOffer(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else {
            call.reject("peerId обязателен")
            return
        }
        queue.async {
            let pc = self.peer(for: peerId)
            pc.offer(for: self.constraints(peerId)) { sdp, error in
                guard let sdp else {
                    call.reject(error?.localizedDescription ?? "offer не создан")
                    return
                }
                pc.setLocalDescription(sdp) { _ in
                    self.notifyListeners("sdp", data: [
                        "peerId": peerId, "type": "offer", "sdp": sdp.sdp,
                    ])
                    call.resolve()
                }
            }
        }
    }

    @objc func setRemoteDescription(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId"),
              let type = call.getString("type"),
              let sdp = call.getString("sdp") else {
            call.reject("нужны peerId, type и sdp")
            return
        }
        let video = call.getBool("video") ?? false
        queue.async {
            if video { self.videoPeers.insert(peerId) }
            let pc = self.peer(for: peerId)
            let desc = RTCSessionDescription(type: type == "offer" ? .offer : .answer, sdp: sdp)
            pc.setRemoteDescription(desc) { error in
                if let error {
                    call.reject(error.localizedDescription)
                    return
                }
                guard type == "offer" else {
                    call.resolve()
                    return
                }
                // Видеоканал из предложения: «и отправляю, и принимаю», чтобы
                // включать камеру без пересогласования. Предложение без
                // видео (старые клиенты) — канала нет, звонок голосовой.
                // Второй видеоканал — демонстрация собеседника: только приём.
                if self.videoPeers.contains(peerId) {
                    for (i, t) in pc.transceivers.filter({ $0.mediaType == .video }).enumerated() {
                        var err: NSError?
                        if i == 0 {
                            t.setDirection(.sendRecv, error: &err)
                            t.sender.streamIds = ["hyax"]
                            if let track = self.videoTrack { t.sender.track = track }
                        } else {
                            t.setDirection(.recvOnly, error: &err)
                            t.sender.track = nil
                        }
                    }
                }
                // На входящий offer сразу отвечаем: лишний круг через JS
                // только добавил бы задержку перед первым звуком.
                pc.answer(for: self.constraints(peerId)) { answer, error in
                    guard let answer else {
                        call.reject(error?.localizedDescription ?? "answer не создан")
                        return
                    }
                    pc.setLocalDescription(answer) { _ in
                        self.notifyListeners("sdp", data: [
                            "peerId": peerId, "type": "answer", "sdp": answer.sdp,
                        ])
                        call.resolve()
                    }
                }
            }
        }
    }

    @objc func addCandidate(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId"),
              let candidate = call.getString("candidate") else {
            call.reject("нужны peerId и candidate")
            return
        }
        let mid = call.getString("sdpMid")
        let index = call.getInt("sdpMLineIndex") ?? 0
        queue.async {
            let ice = RTCIceCandidate(sdp: candidate, sdpMLineIndex: Int32(index), sdpMid: mid)
            self.peer(for: peerId).add(ice) { _ in }
            call.resolve()
        }
    }

    @objc func closePeer(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else {
            call.reject("peerId обязателен")
            return
        }
        queue.async {
            self.drop(peerId)
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        queue.async {
            self.peers.keys.forEach { self.drop($0) }
            self.audioTrack = nil
            self.stopCamera()
            self.videoPeers.removeAll()
            self.remoteVideoTracks.removeAll()
            self.stopDiag()
            NativeCallAudio.shared.endCall()
            DispatchQueue.main.async { self.applyLayout(remotes: [], local: nil, localRadius: 0, tracks: [:]) }
            call.resolve()
        }
    }

    // MARK: - Видео

    /// Камера вкл/выкл. Разрешения нет — reject("denied"): iOS второй раз не
    /// спрашивает, страница предложит открыть настройки.
    @objc func setVideo(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        if !on {
            queue.async {
                self.setSenders(nil)
                self.stopCamera()
                call.resolve(["on": false, "front": self.front, "canFlip": Self.canFlip])
            }
            return
        }
        let go = {
            self.queue.async {
                guard self.startCamera() else { call.reject("no_camera"); return }
                self.setSenders(self.videoTrack)
                call.resolve(["on": true, "front": self.front, "canFlip": Self.canFlip])
            }
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: go()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in granted ? go() : call.reject("denied") }
        default: call.reject("denied")
        }
    }

    @objc func flipCamera(_ call: CAPPluginCall) {
        queue.async {
            guard self.capturer != nil else { call.resolve(["front": self.front]); return }
            self.front.toggle()
            if !self.startCamera() { self.front.toggle(); _ = self.startCamera() }
            call.resolve(["front": self.front])
        }
    }

    /// Где рисовать видео: прямоугольники в точках относительно WebView
    /// (те же CSS-пиксели). remotes — участники по peerId, local — своё
    /// превью; пусто — видео нет, WebView снова непрозрачный.
    @objc func setVideoLayout(_ call: CAPPluginCall) {
        let remotes: [PeerFrame] = (call.getArray("remotes", JSObject.self) ?? []).compactMap { o in
            guard let id = o["peerId"] as? String, let r = Self.rect(o) else { return nil }
            return PeerFrame(peerId: id, rect: r, radius: Self.radius(o), fit: (o["fit"] as? Bool) ?? false)
        }
        let localObj = call.getObject("local")
        let local = Self.rect(localObj)
        let localRadius = Self.radius(localObj)
        queue.async {
            let tracks = self.remoteVideoTracks
            DispatchQueue.main.async {
                self.applyLayout(remotes: remotes, local: local, localRadius: localRadius, tracks: tracks)
                call.resolve()
            }
        }
    }

    /// Кто говорит: уровень входящего звука по каждому соединению и свой
    /// микрофон (0…1) — из статистики WebRTC.
    // MARK: - Отладка звука (только Debug, см. CallDiag)

    private var diagTimer: DispatchSourceTimer?

    /// Каждые 3 с: уровень и энергия микрофона, отправленные и принятые
    /// пакеты по каждому участнику, состояние аудио-сессии. По ним видно,
    /// какая сторона молчит: микрофон пишет тишину или пакеты не уходят.
    private func startDiag() {
        #if DEBUG
        guard diagTimer == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 2, repeating: 3)
        t.setEventHandler { [weak self] in self?.logDiag() }
        diagTimer = t
        t.resume()
        #endif
    }

    private func stopDiag() {
        diagTimer?.cancel()
        diagTimer = nil
    }

    private func logDiag() {
        CallDiag.log("diag track=\(audioTrack.map { $0.isEnabled ? "on" : "off" } ?? "nil") peers=\(peers.count) \(CallDiag.session())")
        for (id, pc) in peers {
            pc.statistics { report in
                var parts: [String] = []
                for st in report.statistics.values where (st.values["kind"] as? String) == "audio" {
                    let v = { (k: String) in st.values[k].map { "\($0)" } ?? "-" }
                    switch st.type {
                    case "media-source": parts.append("mic level=\(v("audioLevel")) energy=\(v("totalAudioEnergy"))")
                    case "outbound-rtp": parts.append("out pkts=\(v("packetsSent")) bytes=\(v("bytesSent"))")
                    case "inbound-rtp": parts.append("in pkts=\(v("packetsReceived")) level=\(v("audioLevel"))")
                    default: break
                    }
                }
                CallDiag.log("diag \(id.prefix(8)) ice=\(pc.iceConnectionState.rawValue) \(parts.sorted().joined(separator: " | "))")
            }
        }
    }

    @objc func getAudioLevels(_ call: CAPPluginCall) {
        queue.async {
            let group = DispatchGroup()
            let lock = NSLock()
            var levels: [String: Double] = [:]
            var local = 0.0
            for (id, pc) in self.peers {
                group.enter()
                pc.statistics { report in
                    var incoming = 0.0, outgoing = 0.0
                    for st in report.statistics.values {
                        guard (st.values["kind"] as? String) == "audio",
                              let level = (st.values["audioLevel"] as? NSNumber)?.doubleValue else { continue }
                        let remoteSource = (st.values["remoteSource"] as? NSNumber)?.boolValue
                        if st.type == "inbound-rtp" || (st.type == "track" && remoteSource == true) {
                            incoming = max(incoming, level)
                        } else if st.type == "media-source" || (st.type == "track" && remoteSource == false) {
                            outgoing = max(outgoing, level)
                        }
                    }
                    lock.lock(); levels[id] = incoming; local = max(local, outgoing); lock.unlock()
                    group.leave()
                }
            }
            group.notify(queue: self.queue) {
                call.resolve(["peers": levels, "local": local])
            }
        }
    }

    /// Настройки приложения в системе: после отказа iOS доступ к камере
    /// второй раз не спрашивает, дать его можно только там.
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }

    private static var canFlip: Bool {
        RTCCameraVideoCapturer.captureDevices().contains { $0.position == .front }
            && RTCCameraVideoCapturer.captureDevices().contains { $0.position == .back }
    }

    private struct PeerFrame { let peerId: String; let rect: CGRect; let radius: CGFloat; let fit: Bool }

    private static func radius(_ o: JSObject?) -> CGFloat { CGFloat((o?["r"] as? Double) ?? 0) }

    private static func rect(_ o: JSObject?) -> CGRect? {
        guard let o, let w = o["w"] as? Double, let h = o["h"] as? Double, w > 0, h > 0 else { return nil }
        return CGRect(x: (o["x"] as? Double) ?? 0, y: (o["y"] as? Double) ?? 0, width: w, height: h)
    }

    /// Камера с нужной стороны (на очереди плагина).
    private func startCamera() -> Bool {
        let devices = RTCCameraVideoCapturer.captureDevices()
        guard let device = devices.first(where: { $0.position == (front ? .front : .back) }) ?? devices.first else { return false }
        if videoSource == nil {
            let source = NativeCallPlugin.factory.videoSource()
            videoSource = source
            capturer = RTCCameraVideoCapturer(delegate: source)
            videoTrack = NativeCallPlugin.factory.videoTrack(with: source, trackId: "hyax-video")
        }
        guard let capturer else { return false }
        // Формат ближе к 1280×720: картинка чёткая, а нагрузка умеренная.
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        let target: Int32 = 1280 * 720
        let format = formats.min { a, b in
            let da = CMVideoFormatDescriptionGetDimensions(a.formatDescription), db = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
            return abs(da.width * da.height - target) < abs(db.width * db.height - target)
        }
        guard let format else { return false }
        let fps = min(30, Int(format.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 30))
        capturer.startCapture(with: device, format: format, fps: fps)
        DispatchQueue.main.async { self.localView?.captureSession = capturer.captureSession }
        return true
    }

    private func stopCamera() {
        capturer?.stopCapture()
        capturer = nil
        videoTrack = nil
        videoSource = nil
        DispatchQueue.main.async { self.localView?.captureSession = nil }
    }

    /// Камера — только в первый видеоканал (второй — демонстрация собеседника).
    private func setSenders(_ track: RTCVideoTrack?) {
        for (id, pc) in peers where videoPeers.contains(id) {
            pc.transceivers.first { $0.mediaType == .video }?.sender.track = track
        }
    }

    fileprivate func storeRemoteVideo(_ peerId: String, _ track: RTCVideoTrack) {
        queue.async {
            self.remoteVideoTracks[peerId] = track
            DispatchQueue.main.async {
                guard let v = self.remoteViews[peerId] else { return }
                self.viewTracks[peerId]?.remove(v)
                track.add(v)
                self.viewTracks[peerId] = track
            }
        }
    }

    /// Нативные окна под WebView: по окну на участника с видео и своё
    /// превью. Видео есть — WebView прозрачный, иначе снова непрозрачный
    /// (так быстрее рисуется всё остальное приложение).
    private func applyLayout(remotes: [PeerFrame], local: CGRect?, localRadius: CGFloat, tracks: [String: RTCVideoTrack]) {
        guard let web = bridge?.webView, let host = web.superview else { return }
        let origin = web.frame.origin
        let wanted = Set(remotes.map { $0.peerId })
        // Ушедшие и те, кто выключил камеру, — без окна.
        for (id, v) in remoteViews where !wanted.contains(id) {
            viewTracks[id]?.remove(v)
            viewTracks.removeValue(forKey: id)
            v.removeFromSuperview()
            remoteViews.removeValue(forKey: id)
        }
        for f in remotes {
            let v: RTCMTLVideoView
            if let existing = remoteViews[f.peerId] {
                v = existing
            } else {
                v = RTCMTLVideoView(frame: .zero)
                v.videoContentMode = .scaleAspectFill
                v.backgroundColor = .black
                v.clipsToBounds = true
                remoteViews[f.peerId] = v
            }
            // Демонстрация — кадр целиком, камеры — с обрезкой по окну.
            v.videoContentMode = f.fit ? .scaleAspectFit : .scaleAspectFill
            // Дорожка могла смениться (переподключение) — привязываем актуальную.
            if let t = tracks[f.peerId], viewTracks[f.peerId] !== t {
                viewTracks[f.peerId]?.remove(v)
                t.add(v)
                viewTracks[f.peerId] = t
            }
            v.layer.cornerRadius = f.radius
            v.frame = f.rect.offsetBy(dx: origin.x, dy: origin.y)
            // Под страницей; позицию самой страницы среди окон не трогаем.
            host.insertSubview(v, belowSubview: web)
        }
        if let local {
            if localView == nil {
                let v = RTCCameraPreviewView(frame: .zero)
                v.backgroundColor = .black
                v.clipsToBounds = true
                (v.layer as? AVCaptureVideoPreviewLayer)?.videoGravity = .resizeAspectFill
                localView = v
                v.captureSession = capturer?.captureSession
            }
            if let lv = localView {
                lv.layer.cornerRadius = localRadius
                lv.frame = local.offsetBy(dx: origin.x, dy: origin.y)
                lv.isHidden = false
                // Своё превью — над окнами участников (в личном звонке оно в углу поверх).
                host.insertSubview(lv, belowSubview: web)
            }
        } else {
            localView?.isHidden = true
        }
        let anyVideo = !remotes.isEmpty || local != nil
        if anyVideo && !layoutActive {
            layoutActive = true
            webViewWasOpaque = web.isOpaque
            webViewBackground = web.backgroundColor
            webScrollBackground = web.scrollView.backgroundColor
            web.isOpaque = false
            web.backgroundColor = .clear
            web.scrollView.backgroundColor = .clear
        } else if !anyVideo && layoutActive {
            layoutActive = false
            web.isOpaque = webViewWasOpaque
            web.backgroundColor = webViewBackground
            web.scrollView.backgroundColor = webScrollBackground
            localView?.captureSession = nil
            localView?.removeFromSuperview(); localView = nil
        }
    }

    @objc func setMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        queue.async {
            CallDiag.log("setMuted \(muted) track=\(self.audioTrack != nil)")
            self.audioTrack?.isEnabled = !muted
            call.resolve()
        }
    }

    /// Громкость участника: 1 — как есть, 0 — тишина, до 2 — громче
    /// (RTCAudioSource.volume принимает 0…10).
    @objc func setPeerVolume(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else { call.reject("peerId"); return }
        let volume = max(0, min(10, call.getDouble("volume") ?? 1))
        queue.async {
            self.peerVolumes[peerId] = volume
            self.remoteTracks[peerId]?.source.volume = volume
            call.resolve()
        }
    }

    /// Делегат: пришла дорожка участника — запоминаем и применяем громкость,
    /// если её выставили раньше, чем дорожка появилась.
    fileprivate func storeRemote(_ peerId: String, _ track: RTCAudioTrack) {
        queue.async {
            self.remoteTracks[peerId] = track
            if let v = self.peerVolumes[peerId] { track.source.volume = v }
        }
    }

    // MARK: - Внутреннее

    private static let mediaConstraints = RTCMediaConstraints(
        mandatoryConstraints: ["OfferToReceiveAudio": "true"],
        optionalConstraints: nil)
    private static let videoConstraints = RTCMediaConstraints(
        mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "true"],
        optionalConstraints: nil)

    private func constraints(_ peerId: String) -> RTCMediaConstraints {
        videoPeers.contains(peerId) ? Self.videoConstraints : Self.mediaConstraints
    }

    private func peer(for peerId: String) -> RTCPeerConnection {
        if let existing = peers[peerId] { return existing }

        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually

        let delegate = PeerDelegate(peerId: peerId, plugin: self)
        let pc = NativeCallPlugin.factory.peerConnection(
            with: config,
            constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil),
            delegate: delegate)!
        if let audioTrack {
            pc.add(audioTrack, streamIds: ["hyax"])
        }
        // Видеоканалы звонящего добавляет createPeer, отвечающий получит
        // их из предложения — см. setRemoteDescription.
        peers[peerId] = pc
        delegates[peerId] = delegate
        return pc
    }

    private func drop(_ peerId: String) {
        peers[peerId]?.close()
        peers.removeValue(forKey: peerId)
        remoteVideoTracks.removeValue(forKey: peerId)
        remoteVideoTracks.removeValue(forKey: "\(peerId)#screen")
        delegates.removeValue(forKey: peerId)
        remoteTracks.removeValue(forKey: peerId)
        peerVolumes.removeValue(forKey: peerId)
    }

    fileprivate func emitCandidate(_ peerId: String, _ candidate: RTCIceCandidate) {
        notifyListeners("iceCandidate", data: [
            "peerId": peerId,
            "candidate": candidate.sdp,
            "sdpMid": candidate.sdpMid ?? "",
            "sdpMLineIndex": Int(candidate.sdpMLineIndex),
        ])
    }

    fileprivate func emitState(_ peerId: String, _ state: String) {
        notifyListeners("peerState", data: ["peerId": peerId, "state": state])
    }
}

/// Колбэки соединения приходят без указания участника — поэтому у каждого
/// свой делегат, который помнит, чей он.
private final class PeerDelegate: NSObject, RTCPeerConnectionDelegate {
    private let peerId: String
    private weak var plugin: NativeCallPlugin?

    init(peerId: String, plugin: NativeCallPlugin) {
        self.peerId = peerId
        self.plugin = plugin
    }

    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        plugin?.emitCandidate(peerId, candidate)
    }

    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        let name: String
        switch newState {
        case .connected: name = "connected"
        case .disconnected: name = "disconnected"
        case .failed: name = "failed"
        case .closed: name = "closed"
        case .connecting: name = "connecting"
        default: name = "new"
        }
        plugin?.emitState(peerId, name)
    }

    func peerConnection(_ pc: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams mediaStreams: [RTCMediaStream]) {
        if let track = rtpReceiver.track as? RTCAudioTrack { plugin?.storeRemote(peerId, track) }
        if let track = rtpReceiver.track as? RTCVideoTrack {
            // Второй видеоканал — демонстрация экрана, своим окном, не вместо камеры.
            let vids = pc.transceivers.filter { $0.mediaType == .video }
            let screen = vids.count > 1 && vids[1].receiver.receiverId == rtpReceiver.receiverId
            plugin?.storeRemoteVideo(screen ? "\(peerId)#screen" : peerId, track)
        }
    }

    // Остальные требования протокола нам не нужны: звук воспроизводится
    // движком сам, видео и каналы данных не используем.
    func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}

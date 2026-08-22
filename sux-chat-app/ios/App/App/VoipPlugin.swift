import Foundation
import Capacitor
import PushKit
import CallKit
import AVFoundation
import UIKit

/// Звонки «как у Telegram»: VoIP-пуш (PushKit) будит приложение даже убитым,
/// а CallKit показывает системный экран входящего вызова поверх блокировки.
///
/// Менеджер живёт с момента запуска (AppDelegate), потому что iOS требует
/// зарегистрировать PushKit до прихода пуша и обязывает показать CallKit на
/// каждый VoIP-пуш — иначе приложение убивают и пуши перестают доставлять.
/// Плагин (ниже) — тонкий мост к JS: пробрасывает события и команды.
final class VoipManager: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
    static let shared = VoipManager()

    private struct CallInfo {
        let uuid: UUID
        let payload: [String: Any]
        var answered = false
    }

    private var registry: PKPushRegistry?
    private let provider: CXProvider
    private let callController = CXCallController()
    private var calls: [String: CallInfo] = [:]  // call_id → CallKit call
    private var ringTimers: [String: Timer] = [:]

    /// Желаемый маршрут звука. WebKit перенастраивает сессию по своему
    /// расписанию и сбрасывает override — поэтому помним выбор и повторяем
    /// его на каждую смену маршрута, пока идёт разговор.
    private var desiredSpeaker: Bool?
    /// Звонки, принятые с заблокированного экрана: CallKit держит их, пока
    /// приложение не станет активным, иначе iOS усыпит процесс и разговор
    /// умрёт. Отпускаем при выходе приложения на передний план.
    private var pendingRelease: [String] = []

    private(set) var voipToken: String?
    /// Ответ с экрана блокировки, пока JS ещё не загрузился.
    private(set) var pendingAnswer: [String: Any]?
    weak var plugin: VoipPlugin?

    private override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = false
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.ringtoneSound = "call.caf"
        if let icon = UIImage(named: "AppIcon") {
            config.iconTemplateImageData = icon.pngData()
        }
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(routeChanged),
            name: AVAudioSession.routeChangeNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(appBecameActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    @objc private func routeChanged() {
        applySpeakerOverride()
    }

    @objc private func appBecameActive() {
        // Пользователь открыл приложение — разговор дальше ведёт WebView,
        // системный звонок больше не нужен (и держал бы микрофон немым).
        let ids = pendingRelease
        pendingRelease.removeAll()
        for id in ids {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.end(callId: id, reason: .answeredElsewhere)
            }
        }
        applySpeakerOverride()
    }

    func start() {
        guard registry == nil else { return }
        let reg = PKPushRegistry(queue: .main)
        reg.delegate = self
        reg.desiredPushTypes = [.voIP]
        registry = reg
    }

    // MARK: - PushKit

    func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
        let token = credentials.token.map { String(format: "%02x", $0) }.joined()
        voipToken = token
        plugin?.notifyListeners("voipToken", data: ["token": token])
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        voipToken = nil
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType, completion: @escaping () -> Void) {
        // dictionaryPayload — [AnyHashable: Any]; нам нужны строковые ключи.
        var data: [String: Any] = [:]
        for (k, v) in payload.dictionaryPayload {
            if let key = k as? String { data[key] = v }
        }
        let callId = (data["call_id"] as? String) ?? UUID().uuidString
        let kind = (data["type"] as? String) ?? "incoming_call"

        if kind == "call_ended" {
            // Отбой приходит тихим FCM-пушем, но на всякий случай умеем и так.
            if calls[callId] != nil {
                end(callId: callId, reason: .remoteEnded)
                completion()
                return
            }
        }

        // Правило iOS: на каждый VoIP-пуш — reportNewIncomingCall, без исключений.
        let uuid = UUID(uuidString: callId) ?? UUID()
        // В группе звонит не человек, а сама группа — так и подписываем.
        let isGroup = (data["group"] as? String) == "1"
        let caller = (data["from_username"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "ХУЯКС"
        let groupName = (data["chat_name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Группа"
        let name = isGroup ? "\(groupName) · \(caller)" : caller
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: name)
        update.localizedCallerName = name
        update.hasVideo = (data["call_type"] as? String) == "video"
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false

        calls[callId] = CallInfo(uuid: uuid, payload: data)
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error != nil || kind != "incoming_call" {
                self?.calls.removeValue(forKey: callId)
                self?.provider.reportCall(with: uuid, endedAt: nil, reason: .failed)
            } else {
                self?.armRingTimeout(callId: callId)
            }
            completion()
        }
    }

    /// Звонящий отвалился, а пуш-отбой не дошёл — не звоним вечно.
    private func armRingTimeout(callId: String) {
        ringTimers[callId]?.invalidate()
        ringTimers[callId] = Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { [weak self] _ in
            guard let self, let info = self.calls[callId], !info.answered else { return }
            self.end(callId: callId, reason: .unanswered)
        }
    }

    // MARK: - Команды из JS

    /// Исходящий звонок системе не отдаём.
    ///
    /// Разговор ведёт WebView, а CallKit забирает аудио-сессию себе — микрофон
    /// у движка становится немым, и собеседник слышит тишину (в статистике
    /// WebRTC исходящих пакетов с айфона не было вовсе). Системный экран нужен
    /// только для входящего вызова на заблокированном экране, поэтому здесь
    /// ничего не делаем: звук остаётся у движка, как в веб-версии.
    func reportOutgoing(callId: String, name: String) {}

    func reportConnected(callId: String) {
        // Соединение состоялось — системе сообщать нечего: исходящие вызовы
        // мы ей не отдаём, а входящий к этому моменту уже отпущен.
    }

    func end(callId: String, reason: CXCallEndedReason = .remoteEnded) {
        desiredSpeaker = nil
        pendingRelease.removeAll { $0 == callId }
        guard let info = calls.removeValue(forKey: callId) else { return }
        ringTimers[callId]?.invalidate()
        ringTimers.removeValue(forKey: callId)
        provider.reportCall(with: info.uuid, endedAt: nil, reason: reason)
    }

    func takePendingAnswer() -> [String: Any]? {
        defer { pendingAnswer = nil }
        return pendingAnswer
    }

    // MARK: - CXProviderDelegate

    func providerDidReset(_ provider: CXProvider) {
        calls.removeAll()
        ringTimers.values.forEach { $0.invalidate() }
        ringTimers.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let (callId, info) = calls.first(where: { $0.value.uuid == action.callUUID }) else {
            action.fail()
            return
        }
        calls[callId]?.answered = true
        ringTimers[callId]?.invalidate()
        var js = jsPayload(info.payload)
        js["callId"] = callId
        if let plugin {
            plugin.notifyListeners("callAnswered", data: js)
        } else {
            pendingAnswer = js
        }
        action.fulfill()

        // Пока CallKit держит сессию, микрофон WebView молчит — поэтому после
        // ответа системный вызов отпускаем. Но только когда приложение на
        // переднем плане: если ответили с заблокированного экрана, CallKit —
        // единственное, что удерживает процесс живым.
        if UIApplication.shared.applicationState == .active {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                self?.end(callId: callId, reason: .answeredElsewhere)
            }
        } else {
            pendingRelease.append(callId)
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if let (callId, _) = calls.first(where: { $0.value.uuid == action.callUUID }) {
            calls.removeValue(forKey: callId)
            ringTimers[callId]?.invalidate()
            plugin?.notifyListeners("callEnded", data: ["callId": callId])
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        if let (callId, _) = calls.first(where: { $0.value.uuid == action.callUUID }) {
            plugin?.notifyListeners("callMuted", data: ["callId": callId, "muted": action.isMuted])
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // Система активировала сессию — сразу выводим звук в громкую связь,
        // иначе WKWebView оставит его в разговорном динамике.
        try? audioSession.overrideOutputAudioPort(.speaker)
    }

    private func configureAudioSession() {
        // Раньше здесь ставилась категория playAndRecord/voiceChat. Это
        // конфликтовало с сессией WebKit, который ведёт сам разговор:
        // звонок соединялся, но был беззвучным. Настройку оставляем ему.
    }

    /// Переключение выхода. Категорию и активацию сессии не трогаем: ими
    /// владеет WebKit, который ведёт сам разговор, — вмешательство глушило
    /// звук. Меняем только маршрут, и повторяем выбор при каждой смене
    /// маршрута: WebKit сбрасывает override, когда перенастраивает сессию.
    func setSpeaker(_ enabled: Bool) {
        desiredSpeaker = enabled
        applySpeakerOverride()
    }

    private func applySpeakerOverride() {
        guard let want = desiredSpeaker else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            try? AVAudioSession.sharedInstance().overrideOutputAudioPort(want ? .speaker : .none)
        }
    }

    private func jsPayload(_ p: [String: Any]) -> [String: Any] {
        return [
            "chatId": p["chat_id"] as? String ?? "",
            "fromUserId": p["from_user_id"] as? String ?? "",
            "fromUsername": p["from_username"] as? String ?? "",
            "fromUserAvatar": p["from_user_avatar"] as? String ?? "",
            "callType": p["call_type"] as? String ?? "audio",
            "group": (p["group"] as? String) == "1",
            "chatName": p["chat_name"] as? String ?? "",
        ]
    }
}

@objc(VoipPlugin)
public class VoipPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VoipPlugin"
    public let jsName = "Voip"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingAnswer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportOutgoingCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportConnected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSpeaker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
    ]

    public override func load() {
        VoipManager.shared.plugin = self
    }

    @objc func register(_ call: CAPPluginCall) {
        VoipManager.shared.start()
        if let token = VoipManager.shared.voipToken {
            notifyListeners("voipToken", data: ["token": token])
        }
        call.resolve()
    }

    @objc func getPendingAnswer(_ call: CAPPluginCall) {
        if let pending = VoipManager.shared.takePendingAnswer() {
            call.resolve(["call": pending])
        } else {
            call.resolve(["call": NSNull()])
        }
    }

    @objc func reportOutgoingCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else { call.reject("callId обязателен"); return }
        VoipManager.shared.reportOutgoing(callId: callId, name: call.getString("name") ?? "ХУЯКС")
        call.resolve()
    }

    @objc func reportConnected(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else { call.reject("callId обязателен"); return }
        VoipManager.shared.reportConnected(callId: callId)
        call.resolve()
    }

    @objc func setSpeaker(_ call: CAPPluginCall) {
        VoipManager.shared.setSpeaker(call.getBool("enabled") ?? true)
        call.resolve()
    }

    @objc func endCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else { call.reject("callId обязателен"); return }
        VoipManager.shared.end(callId: callId)
        call.resolve()
    }
}

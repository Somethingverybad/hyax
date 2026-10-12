import Foundation
import PushKit
import CallKit
import AVFoundation
import UIKit

/// Звонки «как у Telegram»: VoIP-пуш будит приложение, CallKit показывает
/// системный экран поверх блокировки (перенос VoipManager из WhoYaX).
/// Действия пользователя с системного экрана уходят в CallService.
final class VoipManager: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
    static let shared = VoipManager()

    var onAnswer: ((String, [String: Any]) -> Void)?   // callId, payload пуша
    var onEnd: ((String) -> Void)?
    var onMuted: ((String, Bool) -> Void)?
    var onToken: ((String) -> Void)?

    private struct CallInfo { let uuid: UUID; let payload: [String: Any]; var answered = false }
    private var registry: PKPushRegistry?
    private let provider: CXProvider
    private let callController = CXCallController()
    private var calls: [String: CallInfo] = [:]
    private var ringTimers: [String: Timer] = [:]
    private(set) var voipToken: String?

    private override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = false
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.ringtoneSound = "call.caf"
        if let icon = UIImage(named: "AppMark") { config.iconTemplateImageData = icon.pngData() }
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    func start() {
        guard registry == nil else { return }
        let reg = PKPushRegistry(queue: .main)
        reg.delegate = self
        reg.desiredPushTypes = [.voIP]
        registry = reg
    }

    // MARK: PushKit

    func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
        let token = credentials.token.map { String(format: "%02x", $0) }.joined()
        voipToken = token
        AppLog.shared.add("voip: токен получен")
        onToken?(token)
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) { voipToken = nil }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        var data: [String: Any] = [:]
        for (k, v) in payload.dictionaryPayload { if let key = k as? String { data[key] = v } }
        let callId = (data["call_id"] as? String) ?? UUID().uuidString
        let kind = (data["type"] as? String) ?? "incoming_call"
        if kind == "call_ended", calls[callId] != nil { end(callId: callId, reason: .remoteEnded); completion(); return }
        AppLog.shared.add("voip: пуш \(kind)")
        // Правило iOS: на каждый VoIP-пуш — reportNewIncomingCall.
        showIncoming(callId: callId, data: data, valid: kind == "incoming_call", completion: completion)
    }

    private func showIncoming(callId: String, data: [String: Any], valid: Bool = true, completion: (() -> Void)? = nil) {
        let uuid = UUID(uuidString: callId) ?? UUID()
        let isGroup = (data["group"] as? String) == "1" || (data["group"] as? Bool) == true
        let caller = (data["from_username"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "WYX"
        let name = isGroup ? "\((data["chat_name"] as? String) ?? "Группа") · \(caller)" : caller
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: name)
        update.localizedCallerName = name
        update.hasVideo = false
        update.supportsHolding = false; update.supportsGrouping = false; update.supportsUngrouping = false; update.supportsDTMF = false
        calls[callId] = CallInfo(uuid: uuid, payload: data)
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            guard let self else { return }
            if error != nil || !valid {
                self.calls.removeValue(forKey: callId)
                if error == nil { self.provider.reportCall(with: uuid, endedAt: nil, reason: .failed) }
            } else { self.armRingTimeout(callId: callId) }
            completion?()
        }
    }

    private func armRingTimeout(callId: String) {
        ringTimers[callId]?.invalidate()
        ringTimers[callId] = Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { [weak self] _ in
            guard let self, let info = self.calls[callId], !info.answered else { return }
            self.end(callId: callId, reason: .unanswered)
        }
    }

    // MARK: команды приложения

    /// Входящий по сокету (приложение живо): показываем сразу, пуш не продублирует.
    func reportIncoming(callId: String, payload: [String: Any]) {
        guard calls[callId] == nil else { return }
        showIncoming(callId: callId, data: payload)
    }

    func reportOutgoing(callId: String, name: String) {
        let uuid = UUID(uuidString: callId) ?? UUID()
        calls[callId] = CallInfo(uuid: uuid, payload: ["call_id": callId], answered: true)
        callController.request(CXTransaction(action: CXStartCallAction(call: uuid, handle: CXHandle(type: .generic, value: name)))) { [weak self] error in
            if error != nil { self?.calls.removeValue(forKey: callId) }
        }
    }

    func reportConnected(callId: String) {
        guard let info = calls[callId] else { return }
        provider.reportOutgoingCall(with: info.uuid, connectedAt: nil)
    }

    func end(callId: String, reason: CXCallEndedReason = .remoteEnded) {
        guard let info = calls.removeValue(forKey: callId) else { return }
        ringTimers[callId]?.invalidate(); ringTimers.removeValue(forKey: callId)
        provider.reportCall(with: info.uuid, endedAt: nil, reason: reason)
    }

    /// Завершить со стороны приложения (кнопка в своём экране).
    func requestEnd(callId: String) {
        guard let info = calls[callId] else { return }
        callController.request(CXTransaction(action: CXEndCallAction(call: info.uuid))) { _ in }
    }

    func setSpeaker(_ on: Bool) { NativeCallAudio.shared.setSpeaker(on) }

    // MARK: CXProviderDelegate

    func providerDidReset(_ provider: CXProvider) { calls.removeAll(); ringTimers.values.forEach { $0.invalidate() }; ringTimers.removeAll() }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: nil); action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let (callId, info) = calls.first(where: { $0.value.uuid == action.callUUID }) else { action.fail(); return }
        calls[callId]?.answered = true
        ringTimers[callId]?.invalidate()
        NativeCallAudio.shared.beginCall()
        onAnswer?(callId, info.payload)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if let (callId, _) = calls.first(where: { $0.value.uuid == action.callUUID }) {
            calls.removeValue(forKey: callId); ringTimers[callId]?.invalidate()
            onEnd?(callId)
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        if let (callId, _) = calls.first(where: { $0.value.uuid == action.callUUID }) { onMuted?(callId, action.isMuted) }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) { NativeCallAudio.shared.activate(audioSession) }
    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) { NativeCallAudio.shared.deactivate(audioSession) }
}

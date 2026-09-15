import Foundation
import Capacitor
import CoreHaptics

/// Сплошная вибрация для Р.Ё.В.
///
/// Системная вибрация (`AudioServicesPlaySystemSound`) — это короткий
/// прерывистый сигнал: сколько её ни повторяй, на ощупь остаётся пульсация.
/// Непрерывный гул на iPhone даёт только Core Haptics — событие
/// `hapticContinuous`, которое держится, пока его не остановят.
///
/// Играем длинными кусками и продлеваем по таймеру: у события есть предел
/// длительности, а держать надо сколько угодно, пока собеседник не отпустит.
@objc(RovHapticsPlugin)
public class RovHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RovHapticsPlugin"
    public let jsName = "RovHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "supported", returnType: CAPPluginReturnPromise),
    ]

    private var engine: CHHapticEngine?
    private var player: CHHapticAdvancedPatternPlayer?
    private var keepAlive: Timer?

    private var available: Bool {
        CHHapticEngine.capabilitiesForHardware().supportsHaptics
    }

    @objc func supported(_ call: CAPPluginCall) {
        call.resolve(["value": available])
    }

    /// intensity 0..1 — сила гула, sharpness 0..1 — «резкость».
    @objc func start(_ call: CAPPluginCall) {
        guard available else { call.resolve(["value": false]); return }
        let intensity = Float(call.getDouble("intensity") ?? 1.0)
        let sharpness = Float(call.getDouble("sharpness") ?? 0.6)
        DispatchQueue.main.async {
            do {
                try self.ensureEngine()
                try self.play(intensity: intensity, sharpness: sharpness)
                // Продлеваем, пока не остановят: одно событие не может длиться вечно.
                self.keepAlive?.invalidate()
                self.keepAlive = Timer.scheduledTimer(withTimeInterval: 8.0, repeats: true) { [weak self] _ in
                    try? self?.play(intensity: intensity, sharpness: sharpness)
                }
                call.resolve(["value": true])
            } catch {
                call.resolve(["value": false])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.keepAlive?.invalidate()
            self.keepAlive = nil
            try? self.player?.stop(atTime: CHHapticTimeImmediate)
            self.player = nil
            self.engine?.stop()
            self.engine = nil
            call.resolve()
        }
    }

    private func ensureEngine() throws {
        if engine != nil { return }
        let e = try CHHapticEngine()
        // Движок могут остановить извне (звонок, фон) — поднимаем обратно.
        e.stoppedHandler = { [weak self] _ in self?.engine = nil }
        e.resetHandler = { [weak self] in try? self?.engine?.start() }
        try e.start()
        engine = e
    }

    private func play(intensity: Float, sharpness: Float) throws {
        guard let engine = engine else { return }
        let event = CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: 0,
            duration: 10.0
        )
        let pattern = try CHHapticPattern(events: [event], parameters: [])
        try? player?.stop(atTime: CHHapticTimeImmediate)
        let p = try engine.makeAdvancedPlayer(with: pattern)
        try p.start(atTime: CHHapticTimeImmediate)
        player = p
    }
}

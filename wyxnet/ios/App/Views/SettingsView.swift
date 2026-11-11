import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLogout = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Переключение") {
                    Toggle("Переключать узел, если не отвечает", isOn: $model.settings.autoSwitch)
                    Toggle("Менять узел в простое", isOn: $model.settings.rotateIdle)
                    if model.settings.rotateIdle {
                        Picker("Не чаще чем", selection: $model.settings.rotateMinutes) {
                            Text("30 минут").tag(30)
                            Text("1 час").tag(60)
                            Text("2 часа").tag(120)
                            Text("4 часа").tag(240)
                        }
                    }
                    Text("В простое (меньше 300 КБ за 10 минут) трафик уводится на другой живой узел, чтобы не идти всё время в одну точку.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Узел") {
                    Picker("Выбор", selection: Binding(get: { model.settings.preferredNode ?? "" }, set: { model.settings.preferredNode = $0.isEmpty ? nil : $0 })) {
                        Text("Автоматически").tag("")
                        ForEach(model.profile?.nodes ?? []) { Text($0.name).tag($0.id) }
                    }
                }
                Section("Аккаунт") {
                    LabeledContent("Пользователь", value: model.username.map { "@\($0)" } ?? "—")
                    if let u = model.profile?.user.uuid { LabeledContent("Ключ доступа", value: String(u.prefix(8)) + "…") }
                    Button("Выйти", role: .destructive) { confirmLogout = true }
                }
                Section("О приложении") {
                    LabeledContent("Версия", value: API.version)
                    LabeledContent("Ядро Xray", value: model.status.xrayVersion ?? "—")
                    LabeledContent("Сервер", value: API.shared.base.host ?? "")
                    LabeledContent("Подпись профиля", value: Pinned.publicKey == nil ? "не зашита (отладка)" : "проверяется")
                }
            }
            .navigationTitle("Настройки")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Готово") { dismiss() } } }
            .confirmationDialog("Выйти из аккаунта? VPN будет отключён.", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("Выйти", role: .destructive) { model.logout(); dismiss() }
            }
        }
    }
}

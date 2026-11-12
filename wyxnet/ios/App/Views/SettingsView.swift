import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    private var t: Theme { model.theme }
    @Environment(\.dismiss) private var dismiss
    @State private var confirmLogout = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Оформление") {
                    Picker("Тема", selection: $model.appearance) {
                        Text("Мята тёмная").tag("dark")
                        Text("Мята светлая").tag("light")
                    }
                }
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
                Section {
                    Button {
                        model.settings.preferredNode = nil
                    } label: {
                        HStack {
                            Text("Автоматически").foregroundStyle(.primary)
                            Spacer()
                            if model.settings.preferredNode == nil { Image(systemName: "checkmark").foregroundStyle(t.primary) }
                        }
                    }
                    ForEach(model.profile?.nodes ?? []) { n in
                        Button {
                            Task { await model.select(node: n) }
                        } label: {
                            HStack(spacing: 10) {
                                Circle().fill(n.ok ? t.success : t.destructive).frame(width: 9, height: 9)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(n.name).foregroundStyle(.primary)
                                    Text("\(n.kind == "reality" ? "Reality" : "XHTTP") · \(n.ok ? (n.rtt_ms.map { "\($0) мс" } ?? "жив") : "не отвечает из Москвы")")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if model.settings.preferredNode == n.id { Image(systemName: "checkmark").foregroundStyle(t.primary) }
                            }
                        }
                    }
                } header: {
                    HStack {
                        Text("Узел")
                        Spacer()
                        Button { Task { await model.refreshProfile(force: true) } } label: { Image(systemName: "arrow.clockwise") }.font(.caption)
                    }
                } footer: {
                    Text("Выбранный узел становится первым; если он не отвечает, приложение всё равно уйдёт на другой.")
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
            .scrollContentBackground(.hidden)
            .background(GlassBackground(t: t, active: false))
            .tint(t.scheme == .dark ? t.primary : t.primary)
            .preferredColorScheme(t.scheme)
            .navigationTitle("Настройки")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Готово") { dismiss() } } }
            .confirmationDialog("Выйти из аккаунта? VPN будет отключён.", isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("Выйти", role: .destructive) { model.logout(); dismiss() }
            }
        }
    }
}

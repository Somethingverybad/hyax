import SwiftUI

/// Вход и регистрация — в «Мяте»: белая карточка, салатовая главная кнопка.
struct AuthView: View {
    @EnvironmentObject private var session: Session
    @State private var username = ""
    @State private var password = ""
    @State private var registering = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Mint.pageGradient.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer()
                Image("AppMark").resizable().frame(width: 96, height: 96).clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                Text("WYX").font(Inter.bold(34)).foregroundStyle(Mint.title).tracking(2)
                VStack(spacing: 12) {
                    field("Логин", text: $username, secure: false)
                    field("Пароль", text: $password, secure: true)
                    if let error { Text(error).font(Inter.regular(13)).foregroundStyle(.red).multilineTextAlignment(.center) }
                    Button(action: submit) {
                        Text(registering ? "Создать аккаунт" : "Войти")
                            .font(Inter.medium(15)).foregroundStyle(Mint.accentFg)
                            .frame(maxWidth: .infinity).frame(height: 44)
                    }
                    .mintLime().disabled(busy || username.isEmpty || password.isEmpty).opacity(busy ? 0.6 : 1)
                    Button(registering ? "У меня есть аккаунт" : "Нет аккаунта? Зарегистрируйтесь") { registering.toggle(); error = nil }
                        .font(Inter.regular(13)).foregroundStyle(Mint.ink).padding(.top, 4)
                }
                .padding(20).frame(maxWidth: .infinity).mintCard().padding(.horizontal, 17)
                Spacer(); Spacer()
            }
        }
    }

    private func field(_ title: String, text: Binding<String>, secure: Bool) -> some View {
        Group {
            if secure { SecureField(title, text: text) } else { TextField(title, text: text).textInputAutocapitalization(.never).autocorrectionDisabled() }
        }
        .font(Inter.regular(16)).foregroundStyle(Mint.foreground)
        .padding(.horizontal, 16).frame(height: 44)
        .background(Mint.surface3).clipShape(Capsule())
    }

    private func submit() {
        busy = true; error = nil
        Task {
            do {
                if registering { try await API.shared.register(username: username, password: password) }
                else { try await API.shared.login(username: username, password: password) }
                session.loggedIn = true
                await session.start()
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

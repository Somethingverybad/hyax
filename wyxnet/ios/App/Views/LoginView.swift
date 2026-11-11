import SwiftUI

struct LoginView: View {
    @EnvironmentObject var model: AppModel
    @State private var username = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            Text("Сеть WYX").font(.largeTitle.bold())
            Text("Войдите аккаунтом WYX. Доступ к сети выдаётся отдельно.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            VStack(spacing: 12) {
                TextField("Ник или почта", text: $username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                SecureField("Пароль", text: $password)
                    .textContentType(.password)
                    .padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
            }
            if let e = model.error {
                Text(e).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Button {
                Task { await model.login(username: username, password: password) }
            } label: {
                HStack {
                    if model.busy { ProgressView().tint(.white) }
                    Text("Войти").bold()
                }
                .frame(maxWidth: .infinity).padding()
            }
            .buttonStyle(.borderedProminent)
            .disabled(username.isEmpty || password.isEmpty || model.busy)
            Spacer()
            Text("WYX Net \(API.version)").font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(24)
    }
}

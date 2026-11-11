import SwiftUI

struct LoginView: View {
    @EnvironmentObject var model: AppModel
    @State private var username = ""
    @State private var password = ""

    var body: some View {
        ZStack {
            WYX.background.ignoresSafeArea()
            VStack(spacing: 22) {
                Spacer()
                Text("WYX").font(.system(size: 48, weight: .heavy)).tracking(-2).foregroundStyle(WYX.text)
                Text("Сеть").font(.title3).foregroundStyle(WYX.muted).padding(.top, -18)
                VStack(spacing: 10) {
                    TextField("", text: $username, prompt: Text("Ник или почта").foregroundStyle(WYX.muted))
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .wyxField()
                    SecureField("", text: $password, prompt: Text("Пароль").foregroundStyle(WYX.muted))
                        .textContentType(.password)
                        .wyxField()
                }
                .padding(.top, 12)
                if let e = model.error {
                    Text(e).font(.footnote).foregroundStyle(WYX.primary).multilineTextAlignment(.center)
                }
                Button {
                    Task { await model.login(username: username, password: password) }
                } label: {
                    HStack {
                        if model.busy { ProgressView().tint(.white) }
                        Text("Войти").font(.body.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(WYX.primary, in: RoundedRectangle(cornerRadius: WYX.radius))
                    .foregroundStyle(.white)
                }
                .disabled(username.isEmpty || password.isEmpty || model.busy)
                .opacity(username.isEmpty || password.isEmpty ? 0.5 : 1)
                Text("Аккаунт тот же, что в мессенджере. Доступ к сети выдаётся отдельно.")
                    .font(.footnote).foregroundStyle(WYX.muted).multilineTextAlignment(.center)
                Spacer()
                Text("WYX Net \(API.version)").font(.caption2).foregroundStyle(WYX.muted.opacity(0.6))
            }
            .padding(28)
        }
        .preferredColorScheme(.dark)
    }
}

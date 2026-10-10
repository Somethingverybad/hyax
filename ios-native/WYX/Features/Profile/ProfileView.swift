import SwiftUI

/// Профиль (минимум для прототипа): обложка, аватар, имя, выход.
struct ProfileView: View {
    @EnvironmentObject private var session: Session
    var body: some View {
        ScrollView {
            VStack(spacing: 11) {
                Color.clear.frame(height: 70)
                ZStack(alignment: .bottom) {
                    Rectangle().fill(Mint.surface3).frame(height: 139)
                        .shadow(color: .black.opacity(0.25), radius: 6.6, x: 0, y: 4.3)
                    Avatar(profile: session.me, url: nil, name: session.me?.username ?? "?", size: 93, radius: 17)
                        .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).stroke(.white, lineWidth: 2))
                        .offset(y: 47)
                }
                .padding(.bottom, 47)
                Text(session.me?.username ?? "").font(Inter.semibold(17)).foregroundStyle(Mint.title)
                VStack(spacing: 0) {
                    row("row-at", "Имя пользователя", "@" + (session.me?.username ?? ""))
                    Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11)
                    row("row-about", "О себе", "Не указано")
                }
                .mintCard().padding(.horizontal, 17)
                Button { session.logout() } label: {
                    HStack(spacing: 14) {
                        MintIcon("row-logout", 19, 14).foregroundStyle(Mint.ink)
                        Text("Выйти").font(Inter.medium(14.3)).foregroundStyle(Mint.ink)
                        Spacer()
                    }
                    .padding(.horizontal, 18).frame(height: 51)
                }
                .buttonStyle(.plain).mintCard().padding(.horizontal, 17)
                Color.clear.frame(height: 90)
            }
        }
        .overlay(alignment: .top) {
            MintHeader(title: "Профиль", right: {
                MintIcon("pencil", 17, 18).foregroundStyle(Mint.accentFg).frame(width: 56, height: 33).mintLime()
            })
            .background(GlassTop().padding(.bottom, -24).ignoresSafeArea(edges: .top))
        }
    }

    private func row(_ icon: String, _ label: String, _ value: String) -> some View {
        HStack(spacing: 14) {
            MintIcon(icon, 18).foregroundStyle(Mint.ink)
            Text(label).font(Inter.regular(14.3)).foregroundStyle(Mint.label)
            Spacer()
            Text(value).font(Inter.regular(12.7)).foregroundStyle(Mint.mintMuted)
            MintIcon("chevron", 5, 10).foregroundStyle(Mint.mintMuted)
        }
        .padding(.horizontal, 18).frame(height: 51)
    }
}

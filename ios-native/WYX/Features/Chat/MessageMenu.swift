import SwiftUI

let MAIN_REACTIONS = ["❤️", "👍", "👎", "🔥", "😂", "😮", "😢", "🎉", "🤔", "👏", "✅", "❌"]

/// Меню сообщения по долгому нажатию: ряд реакций и действия, как MessageContextMenu.
struct MessageMenu: View {
    let message: Message
    let own: Bool
    let pinned: Bool
    let onReact: (String) -> Void
    let onAction: (Action) -> Void
    let onClose: () -> Void

    enum Action { case reply, copy, pin, edit, deleteMe, deleteAll, forward }

    var body: some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea().onTapGesture { onClose() }
            VStack(spacing: 10) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(MAIN_REACTIONS, id: \.self) { e in
                            let mine = message.reactions?.first { $0.emoji == e }?.mine == true
                            Button { Haptic.light(); onReact(e); onClose() } label: {
                                Text(e).font(.system(size: 26)).frame(width: 44, height: 44)
                                    .background(mine ? Mint.accent.opacity(0.35) : .clear).clipShape(Circle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .frame(height: 52).mintPill()
                VStack(spacing: 0) {
                    row("Ответить", "arrowshape.turn.up.left") { onAction(.reply) }
                    if message.content?.isEmpty == false { divider; row("Копировать", "doc.on.doc") { onAction(.copy) } }
                    divider; row(pinned ? "Открепить" : "Закрепить", "pin") { onAction(.pin) }
                    divider; row("Переслать", "arrowshape.turn.up.right") { onAction(.forward) }
                    if own && message.content?.isEmpty == false && message.sticker == nil { divider; row("Изменить", "pencil") { onAction(.edit) } }
                    divider; row("Удалить у меня", "trash", destructive: true) { onAction(.deleteMe) }
                    if own { divider; row("Удалить у всех", "trash.fill", destructive: true) { onAction(.deleteAll) } }
                }
                .mintCard()
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: 420)
        }
        .onAppear { Haptic.medium() }
    }

    private var divider: some View { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11) }

    private func row(_ title: String, _ icon: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button { action(); onClose() } label: {
            HStack(spacing: 14) {
                Image(systemName: icon).font(.system(size: 16)).foregroundStyle(destructive ? .red : Mint.ink).frame(width: 22)
                Text(title).font(Inter.regular(14.3)).foregroundStyle(destructive ? .red : Mint.label)
                Spacer()
            }
            .padding(.horizontal, 18).frame(height: 48).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Реакции под пузырём; тап переключает свою.
struct ReactionChips: View {
    let reactions: [Reaction]
    let onTap: (String) -> Void
    var body: some View {
        HStack(spacing: 4) {
            ForEach(reactions.filter { $0.count > 0 }, id: \.emoji) { r in
                Button { Haptic.light(); onTap(r.emoji) } label: {
                    HStack(spacing: 3) {
                        Text(r.emoji).font(.system(size: 13))
                        Text("\(r.count)").font(Inter.medium(11)).foregroundStyle(r.mine == true ? Mint.accentFg : Mint.bubbleFg)
                    }
                    .padding(.horizontal, 7).frame(height: 22)
                    .background(r.mine == true ? Mint.accent : .white.opacity(0.18)).clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

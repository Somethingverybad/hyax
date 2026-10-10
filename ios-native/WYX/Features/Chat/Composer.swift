import SwiftUI
import UIKit

/// Поле ввода на UITextView: растёт до 5 строк, отдаёт выделение — панель
/// форматирования оборачивает выделенное маркерами, как в вебе.
struct GrowingTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange
    var placeholder: String
    var focused: Binding<Bool>
    var onHeight: (CGFloat) -> Void

    func makeUIView(context: Context) -> UITextView {
        let tv = UITextView()
        tv.backgroundColor = .clear
        tv.font = UIFont(name: "Inter-Regular", size: 16) ?? .systemFont(ofSize: 16)
        tv.textColor = UIColor(Mint.foreground)
        tv.tintColor = UIColor(Mint.ink)
        tv.textContainerInset = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 4)
        tv.isScrollEnabled = false
        tv.delegate = context.coordinator
        tv.keyboardDismissMode = .interactive
        let ph = UILabel()
        ph.text = placeholder
        ph.font = tv.font
        ph.textColor = UIColor(Mint.mintMuted)
        ph.tag = 7
        ph.translatesAutoresizingMaskIntoConstraints = false
        tv.addSubview(ph)
        NSLayoutConstraint.activate([ph.leadingAnchor.constraint(equalTo: tv.leadingAnchor, constant: 17), ph.topAnchor.constraint(equalTo: tv.topAnchor, constant: 8)])
        return tv
    }

    func updateUIView(_ tv: UITextView, context: Context) {
        if tv.text != text { tv.text = text }
        (tv.viewWithTag(7) as? UILabel)?.isHidden = !text.isEmpty
        if focused.wrappedValue, !tv.isFirstResponder { tv.becomeFirstResponder() }
        if !focused.wrappedValue, tv.isFirstResponder { tv.resignFirstResponder() }
        if context.coordinator.pendingSelection != nil, let r = context.coordinator.pendingSelection, r.location <= (tv.text as NSString).length {
            tv.selectedRange = r; context.coordinator.pendingSelection = nil
        }
        let h = min(120, tv.sizeThatFits(CGSize(width: tv.bounds.width > 0 ? tv.bounds.width : 200, height: .greatestFiniteMagnitude)).height)
        tv.isScrollEnabled = h >= 120
        DispatchQueue.main.async { onHeight(max(40, h)) }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: GrowingTextView
        var pendingSelection: NSRange?
        init(_ p: GrowingTextView) { parent = p }
        func textViewDidChange(_ tv: UITextView) { parent.text = tv.text; parent.selection = tv.selectedRange }
        func textViewDidChangeSelection(_ tv: UITextView) { parent.selection = tv.selectedRange }
        func textViewDidBeginEditing(_ tv: UITextView) { parent.focused.wrappedValue = true }
        func textViewDidEndEditing(_ tv: UITextView) { parent.focused.wrappedValue = false }
    }
}

/// Обернуть выделение маркером (или снять его). Возвращает новый текст и выделение.
enum ComposerFormat {
    static func toggle(_ text: String, selection: NSRange, type: String) -> (String, NSRange) {
        guard let mark = Markers.all.first(where: { $0.type == type })?.mark else { return (text, selection) }
        let ns = text as NSString
        let sel = NSRange(location: min(selection.location, ns.length), length: min(selection.length, ns.length - min(selection.location, ns.length)))
        let m = mark as NSString
        // Уже обёрнуто — снимаем.
        if sel.location >= m.length, sel.location + sel.length + m.length <= ns.length,
           ns.substring(with: NSRange(location: sel.location - m.length, length: m.length)) == mark,
           ns.substring(with: NSRange(location: sel.location + sel.length, length: m.length)) == mark {
            let out = ns.replacingCharacters(in: NSRange(location: sel.location - m.length, length: sel.length + 2 * m.length), with: ns.substring(with: sel))
            return (out, NSRange(location: sel.location - m.length, length: sel.length))
        }
        let inner = ns.substring(with: sel)
        let out = ns.replacingCharacters(in: sel, with: mark + inner + mark)
        return (out, NSRange(location: sel.location + m.length, length: sel.length))
    }
}

struct FormatToolbar: View {
    let onApply: (String) -> Void
    private let items: [(String, String, String)] = [
        ("bold", "bold", "Жирный"), ("italic", "italic", "Курсив"), ("underline", "underline", "Подчёркнутый"), ("strike", "strikethrough", "Зачёркнутый"),
        ("code", "chevron.left.forwardslash.chevron.right", "Моноширинный"), ("pre", "curlybraces", "Блок кода"),
        ("spoiler", "eye.slash", "Спойлер"), ("zalgo", "textformat.abc.dottedunderline", "Зальго"), ("scramble", "shuffle", "Перемешать"),
    ]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items, id: \.0) { t in
                    Button { Haptic.light(); onApply(t.0) } label: {
                        Image(systemName: t.1).font(.system(size: 14, weight: .medium)).foregroundStyle(Mint.ink).frame(width: 36, height: 32)
                    }
                    .buttonStyle(.plain).mintPill().accessibilityLabel(t.2)
                }
            }
            .padding(.horizontal, 2).padding(.vertical, 4)
        }
    }
}

/// Подсказки участников при «@…» в группе.
struct MentionHints: View {
    let people: [Profile]
    let onPick: (Profile) -> Void
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(people) { p in
                    Button { Haptic.light(); onPick(p) } label: {
                        HStack(spacing: 6) {
                            Avatar(profile: p, name: p.username, size: 22, radius: 7)
                            Text("@" + p.username).font(Inter.regular(13)).foregroundStyle(Mint.label)
                        }
                        .padding(.horizontal, 10).frame(height: 32)
                    }
                    .buttonStyle(.plain).mintPill()
                }
            }
            .padding(.horizontal, 2).padding(.vertical, 4)
        }
    }
}

/// «@слово» у каретки: диапазон и набранная часть ника.
func mentionQuery(_ text: String, caret: Int) -> (NSRange, String)? {
    let ns = text as NSString
    let upto = min(caret, ns.length)
    var i = upto
    while i > 0 {
        let ch = ns.character(at: i - 1)
        if ch == 64 /* @ */ { // перед @ — начало или пробел/перенос
            if i - 2 >= 0 { let prev = ns.character(at: i - 2); if prev != 32 && prev != 10 { return nil } }
            return (NSRange(location: i - 1, length: upto - (i - 1)), ns.substring(with: NSRange(location: i, length: upto - i)))
        }
        if ch == 32 || ch == 10 { return nil }
        i -= 1
    }
    return nil
}

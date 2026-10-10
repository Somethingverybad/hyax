import SwiftUI

// Разметка сообщений — как lib/format.tsx в вебе: **жирный**, __курсив__,
// ++подчёркнутый++, ~~зачёркнутый~~, `код`, ```блок кода```, ||спойлер||,
// %%зальго%%, ^^перемешанный^^. При отправке маркеры снимаются и становятся
// entities (смещения — в UTF-16, как в JS); при показе entities красят текст.

enum Markers {
    /// Длинные раньше коротких (``` раньше `).
    static let all: [(mark: String, type: String)] = [
        ("```", "pre"), ("**", "bold"), ("__", "italic"), ("++", "underline"), ("~~", "strike"),
        ("||", "spoiler"), ("%%", "zalgo"), ("^^", "scramble"), ("`", "code"),
    ]

    /// Снять маркеры: вернуть чистый текст и entities. Вложенность не разбираем —
    /// как и в вебе, пары ищутся по порядку, снаружи внутрь.
    static func parse(_ text: String) -> (String, [Entity]) {
        var units = Array(text.utf16)
        var entities: [Entity] = []
        var changed = true
        while changed {
            changed = false
            for (mark, type) in all {
                let m = Array(mark.utf16)
                guard let open = find(m, in: units, from: 0) else { continue }
                guard let close = find(m, in: units, from: open + m.count), close > open + m.count else { continue }
                let innerLen = close - (open + m.count)
                units.removeSubrange(close..<close + m.count)
                units.removeSubrange(open..<open + m.count)
                // Сдвигаем уже найденные entities правее открывающего маркера.
                entities = entities.map { e in
                    var e = e
                    if e.offset >= close { e.offset -= m.count * 2 } else if e.offset > open { e.offset -= m.count }
                    return e
                }
                entities.append(Entity(type: type, offset: open, length: innerLen))
                changed = true
                break
            }
        }
        return (String(utf16CodeUnits: units, count: units.count), entities.sorted { $0.offset < $1.offset })
    }

    private static func find(_ needle: [UInt16], in hay: [UInt16], from: Int) -> Int? {
        guard needle.count <= hay.count else { return nil }
        var i = from
        while i + needle.count <= hay.count {
            if Array(hay[i..<i + needle.count]) == needle { return i }
            i += 1
        }
        return nil
    }

    /// Вернуть маркеры в текст (для редактирования).
    static func restore(_ text: String, entities: [Entity]) -> String {
        var units = Array(text.utf16)
        for e in entities.sorted(by: { $0.offset > $1.offset }) {
            guard let mark = all.first(where: { $0.type == e.type })?.mark else { continue }
            let m = Array(mark.utf16)
            let end = min(units.count, e.offset + e.length)
            guard e.offset <= end else { continue }
            units.insert(contentsOf: m, at: end)
            units.insert(contentsOf: m, at: e.offset)
        }
        return String(utf16CodeUnits: units, count: units.count)
    }
}

enum Formatting {
    /// Текст сообщения с оформлением. Спойлеры скрыты, пока revealed == false.
    static func attributed(_ text: String, entities: [Entity], mentions: [Mention], revealed: Bool, seed: Int, textColor: Color, accent: Color) -> AttributedString {
        let units = Array(text.utf16)
        var out = AttributedString()
        // Границы отрезков: каждое начало/конец сущности.
        var cuts: Set<Int> = [0, units.count]
        for e in entities { cuts.insert(max(0, min(units.count, e.offset))); cuts.insert(max(0, min(units.count, e.offset + e.length))) }
        for m in mentions { cuts.insert(max(0, min(units.count, m.offset))); cuts.insert(max(0, min(units.count, m.offset + m.length))) }
        let points = cuts.sorted()
        for (a, b) in zip(points, points.dropFirst()) where b > a {
            var piece = String(utf16CodeUnits: Array(units[a..<b]), count: b - a)
            let active = entities.filter { $0.offset <= a && $0.offset + $0.length >= b }
            let mention = mentions.first { $0.offset <= a && $0.offset + $0.length >= b }
            let types = Set(active.map(\.type))
            if types.contains("zalgo") { piece = zalgo(piece, seed: seed + a) }
            if types.contains("scramble") && !revealed { piece = scramble(piece, seed: seed + a) }
            var s = AttributedString(piece)
            var font = Inter.regular(15)
            if types.contains("bold") { font = Inter.semibold(15) }
            if types.contains("code") || types.contains("pre") { font = .system(size: 13.5, design: .monospaced) }
            s.font = font
            if types.contains("italic") { s.inlinePresentationIntent = .emphasized }
            if types.contains("underline") { s.underlineStyle = .single }
            if types.contains("strike") { s.strikethroughStyle = .single }
            if types.contains("code") { s.backgroundColor = textColor.opacity(0.12) }
            if types.contains("spoiler") && !revealed {
                s.foregroundColor = textColor.opacity(0.0)
                s.backgroundColor = textColor.opacity(0.35)
            }
            if mention != nil { s.font = Inter.semibold(15); s.foregroundColor = accent }
            out.append(s)
        }
        out = linkify(out)
        return out
    }

    private static func linkify(_ s: AttributedString) -> AttributedString {
        var s = s
        let plain = String(s.characters)
        guard let det = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return s }
        for m in det.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
            guard let url = m.url, let r = Range(m.range, in: plain), let ar = Range(r, in: s) else { continue }
            s[ar].link = url
            s[ar].underlineStyle = .single
        }
        return s
    }

    private static let combining: [Character] = ["\u{0300}", "\u{0301}", "\u{0302}", "\u{0303}", "\u{0306}", "\u{0308}", "\u{030C}", "\u{0316}", "\u{0317}", "\u{031E}", "\u{0320}", "\u{0324}", "\u{032B}", "\u{0333}"]

    static func zalgo(_ text: String, seed: Int) -> String {
        var rng = LCG(seed: UInt64(bitPattern: Int64(seed)) &+ 7)
        var out = ""
        for ch in text {
            out.append(ch)
            if ch == " " || ch == "\n" { continue }
            for _ in 0..<(1 + Int(rng.next() % 3)) { out.append(combining[Int(rng.next() % UInt64(combining.count))]) }
        }
        return out
    }

    /// Перемешать буквы внутри слов (первая и последняя на месте) — детерминированно.
    static func scramble(_ text: String, seed: Int) -> String {
        var rng = LCG(seed: UInt64(bitPattern: Int64(seed)) &+ 13)
        return text.split(separator: " ", omittingEmptySubsequences: false).map { w -> String in
            var cs = Array(w)
            guard cs.count > 3 else { return String(w) }
            var mid = Array(cs[1..<cs.count - 1])
            for i in stride(from: mid.count - 1, to: 0, by: -1) { mid.swapAt(i, Int(rng.next() % UInt64(i + 1))) }
            cs.replaceSubrange(1..<cs.count - 1, with: mid)
            return String(cs)
        }.joined(separator: " ")
    }

    struct LCG { var state: UInt64; init(seed: UInt64) { state = seed }
        mutating func next() -> UInt64 { state = state &* 6364136223846793005 &+ 1442695040888963407; return state >> 33 } }
}

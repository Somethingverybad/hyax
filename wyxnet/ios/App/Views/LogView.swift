import SwiftUI

struct LogView: View {
    @EnvironmentObject var model: AppModel
    private var t: Theme { model.theme }
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var xray = ""
    private let timer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(text.isEmpty ? "Пока пусто." : text)
                            .font(.system(.caption2, design: .monospaced))
                            .textSelection(.enabled)
                        if !xray.isEmpty {
                            Text("— ядро Xray —").font(.caption.bold()).foregroundStyle(.secondary)
                            Text(xray).font(.system(.caption2, design: .monospaced)).textSelection(.enabled)
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .onAppear { reload(); proxy.scrollTo("end") }
                .onReceive(timer) { _ in reload() }
            }
            .background(GlassBackground(t: t, active: false))
            .tint(t.primary)
            .preferredColorScheme(t.scheme)
            .navigationTitle("Журнал")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Закрыть") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack {
                        ShareLink(item: text + "\n\n" + xray) { Image(systemName: "square.and.arrow.up") }
                        Button(role: .destructive) { TunnelLog.shared.clear(); reload() } label: { Image(systemName: "trash") }
                    }
                }
            }
        }
    }

    private func reload() {
        text = TunnelLog.shared.read()
        let x = (try? String(contentsOf: AppGroup.xrayLogURL, encoding: .utf8)) ?? ""
        xray = String(x.suffix(6000))
    }
}

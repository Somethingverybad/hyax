import SwiftUI
import MapKit
import CoreLocation
import UniformTypeIdentifiers

/// Меню скрепки: что приложить.
struct AttachMenu: View {
    enum Item { case media, file, location }
    let onPick: (Item) -> Void
    let onClose: () -> Void
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Color.black.opacity(0.001).ignoresSafeArea().onTapGesture { onClose() }
            VStack(spacing: 0) {
                row("Фото или видео", "photo.on.rectangle") { onPick(.media) }
                divider
                row("Файл", "doc") { onPick(.file) }
                divider
                row("Геопозиция", "location") { onPick(.location) }
            }
            .frame(width: 220).mintCard(16)
            .padding(.trailing, 60).padding(.bottom, 56)
        }
    }
    private var divider: some View { Rectangle().fill(Mint.rowDivider).frame(height: 1).padding(.horizontal, 11) }
    private func row(_ t: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button { Haptic.light(); action(); onClose() } label: {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16)).foregroundStyle(Mint.ink).frame(width: 22)
                Text(t).font(Inter.regular(14.3)).foregroundStyle(Mint.label)
                Spacer()
            }
            .padding(.horizontal, 16).frame(height: 46).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Одно определение местоположения с запросом разрешения.
final class LocationOnce: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var cont: CheckedContinuation<CLLocationCoordinate2D?, Never>?
    func get() async -> CLLocationCoordinate2D? {
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        return await withCheckedContinuation { c in cont = c; manager.requestLocation() }
    }
    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        if m.authorizationStatus == .denied || m.authorizationStatus == .restricted { cont?.resume(returning: nil); cont = nil }
    }
    func locationManager(_ m: CLLocationManager, didUpdateLocations l: [CLLocation]) { cont?.resume(returning: l.first?.coordinate); cont = nil }
    func locationManager(_ m: CLLocationManager, didFailWithError e: Error) { cont?.resume(returning: nil); cont = nil }
}

/// Геопозиция в пузыре: карта с меткой, тап — Apple Maps.
struct GeoBubble: View {
    let lat: Double
    let lng: Double
    var body: some View {
        let c = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        Map(initialPosition: .region(MKCoordinateRegion(center: c, latitudinalMeters: 800, longitudinalMeters: 800)), interactionModes: []) {
            Marker("", coordinate: c).tint(Mint.accent)
        }
        .frame(width: 220, height: 140)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture {
            let item = MKMapItem(placemark: MKPlacemark(coordinate: c))
            item.name = "Геопозиция"
            item.openInMaps()
        }
    }
}

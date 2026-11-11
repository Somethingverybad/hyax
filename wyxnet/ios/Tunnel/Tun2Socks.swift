// hev-socks5-tunnel: читает пакеты из utun и гонит их в socks5 Xray. Дескриптор utun
// система не отдаёт — ищем его среди открытых (сокет AF_SYSTEM с именем utun_control).
// По мотивам Tun2SocksKit (Ebrahim Tahernejad, MIT).
import Foundation

enum Socks5Tunnel {
    struct Stats { let upPackets: Int; let upBytes: Int; let downPackets: Int; let downBytes: Int }

    private static var tunnelFileDescriptor: Int32? {
        var ctlInfo = ctl_info()
        withUnsafeMutablePointer(to: &ctlInfo.ctl_name) {
            $0.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: $0.pointee)) {
                _ = strcpy($0, "com.apple.net.utun_control")
            }
        }
        for fd: Int32 in 0...1024 {
            var addr = sockaddr_ctl()
            var ret: Int32 = -1
            var len = socklen_t(MemoryLayout.size(ofValue: addr))
            withUnsafeMutablePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { ret = getpeername(fd, $0, &len) }
            }
            if ret != 0 || addr.sc_family != AF_SYSTEM { continue }
            if ctlInfo.ctl_id == 0 {
                if ioctl(fd, CTLIOCGINFO, &ctlInfo) != 0 { continue }
            }
            if addr.sc_id == ctlInfo.ctl_id { return fd }
        }
        return nil
    }

    /// Запустить в фоне; completion — код завершения (блокирующий вызов внутри).
    static func run(yaml: String, completion: @escaping (Int32) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard let fd = tunnelFileDescriptor else { completion(-1); return }
            let code = yaml.withCString { p in
                p.withMemoryRebound(to: UInt8.self, capacity: yaml.utf8.count) {
                    hev_socks5_tunnel_main_from_str($0, UInt32(yaml.utf8.count), fd)
                }
            }
            completion(code)
        }
    }

    static var stats: Stats {
        var tp = 0, tb = 0, rp = 0, rb = 0
        hev_socks5_tunnel_stats(&tp, &tb, &rp, &rb)
        return Stats(upPackets: tp, upBytes: tb, downPackets: rp, downBytes: rb)
    }

    static func quit() { hev_socks5_tunnel_quit() }
}

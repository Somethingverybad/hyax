// Конфигурация Xray для одного узла: socks-вход для tun2socks и один VLESS-выход
// (Reality или XHTTP). Без geoip/geosite — файлов данных в расширении нет, частные
// сети перечислены явно. Ошибки Xray пишутся в xray.log в App Group (видны в журнале).
import Foundation

enum XrayConfig {
    static let socksPort = 10808

    static let privateNets = [
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16",
        "100.64.0.0/10", "224.0.0.0/4", "fc00::/7", "fe80::/10", "ff00::/8",
    ]

    static func build(node: VpnNode, uuid: String) -> String {
        var user: [String: Any] = ["id": uuid, "encryption": "none"]
        if let flow = node.flow, !flow.isEmpty { user["flow"] = flow }

        var stream: [String: Any]
        if node.isReality {
            stream = [
                "network": "tcp",
                "security": "reality",
                "realitySettings": [
                    "serverName": node.sni,
                    "fingerprint": node.fp ?? "chrome",
                    "publicKey": node.pbk ?? "",
                    "shortId": node.sid ?? "",
                    "spiderX": "/",
                ],
            ]
        } else {
            stream = [
                "network": "xhttp",
                "security": "tls",
                "tlsSettings": [
                    "serverName": node.sni,
                    "alpn": node.alpn ?? ["h2"],
                    "fingerprint": node.fp ?? "chrome",
                ],
                "xhttpSettings": [
                    "host": node.host,
                    "path": node.path ?? "/",
                    "mode": node.mode ?? "auto",
                ],
            ]
        }
        stream["sockopt"] = ["tcpKeepAliveInterval": 30]

        let cfg: [String: Any] = [
            "log": ["loglevel": "warning", "error": AppGroup.xrayLogURL.path],
            "inbounds": [[
                "tag": "socks",
                "listen": "127.0.0.1",
                "port": socksPort,
                "protocol": "socks",
                "settings": ["auth": "noauth", "udp": true],
                "sniffing": ["enabled": true, "destOverride": ["http", "tls", "quic"], "routeOnly": false],
            ]],
            "outbounds": [
                [
                    "tag": "proxy",
                    "protocol": "vless",
                    "settings": ["vnext": [[
                        "address": node.dialAddress,
                        "port": node.port,
                        "users": [user],
                    ]]],
                    "streamSettings": stream,
                ],
                ["tag": "direct", "protocol": "freedom"],
                ["tag": "block", "protocol": "blackhole"],
            ],
            "routing": [
                "domainStrategy": "AsIs",
                "rules": [
                    ["type": "field", "ip": privateNets, "outboundTag": "direct"],
                    ["type": "field", "network": "tcp,udp", "outboundTag": "proxy"],
                ],
            ],
        ]
        let data = try! JSONSerialization.data(withJSONObject: cfg, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    /// Конфигурация hev-socks5-tunnel (Tun2SocksKit): весь tun → socks 127.0.0.1:10808.
    static let tun2socksYAML = """
    tunnel:
      mtu: 9000
      ipv4: 198.18.0.1
      ipv6: 'fd00:7779:7878::2'
    socks5:
      port: \(socksPort)
      address: 127.0.0.1
      udp: 'udp'
    misc:
      task-stack-size: 24576
      tcp-buffer-size: 4096
      max-session-count: 512
      connect-timeout: 5000
      read-write-timeout: 60000
      log-file: stderr
      log-level: warn
      limit-nofile: 65535
    """
}

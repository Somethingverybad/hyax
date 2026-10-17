"""ICE-конфигурация WebRTC: STUN и наш TURN (coturn). Креды — из окружения
сервера, чтобы не зашивать их в сборки и менять без релиза. Отдельным модулем
без DRF: нужна и API (IceServersView), и сокету страницы OBS (consumers.py)."""
import os


def ice_servers():
    servers = [{"urls": "stun:stun.l.google.com:19302"}]
    realm = os.getenv("TURN_REALM", "").strip()
    username = os.getenv("TURN_USERNAME", "").strip()
    password = os.getenv("TURN_PASSWORD", "").strip()
    if realm and username and password:
        servers.append({
            "urls": [f"turn:{realm}:3478?transport=udp", f"turn:{realm}:3478?transport=tcp"],
            "username": username,
            "credential": password,
        })
    return servers

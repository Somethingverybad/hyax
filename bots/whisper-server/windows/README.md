# Распознаватель на Windows-сервере (195.58.153.245, Windows Server 2022)

Тот же `server.py`, без Docker: Python 3.12 из python.org, `pip install faster-whisper==1.2.1 av==13.1.0 ctranslate2==4.8.3`.

- Папка `C:\wyx-whisper`: `server.py`, `run.cmd` (настройки), `token.txt` (WHISPER_TOKEN, права только Administrators/SYSTEM), `certs\cert.pem` + `certs\key.pem` (свой самоподписанный, SAN IP:195.58.153.245; открытая часть — `backend/certs/whisper-msk.pem`), `models\` (веса качаются при первом старте), `logs\server.log`.
- `install.ps1` — права на ключ, правило файрвола (порт 8745 только с 194.164.245.144) и задача планировщика `wyx-whisper` (при загрузке, от SYSTEM, перезапуск раз в минуту при падении).
- **Нужен свежий Visual C++ Redistributable** (`https://aka.ms/vs/17/release/vc_redist.x64.exe /install /quiet /norestart`): со штатным msvcp140 14.0.24215 ctranslate2 падает в конструкторе модели с 0xC0000005 (access violation).
- PowerShell по SSH: многострочные блоки через stdin не выполняются — скрипты загружать файлом (`scp`) и запускать `-File`; предупреждения pip в stderr с `$ErrorActionPreference='Stop'` обрывают установку — pip запускать из `.cmd` с выводом в файл.
- Перезапуск: `Stop-ScheduledTask wyx-whisper; Get-Process python | Stop-Process -Force; Start-ScheduledTask wyx-whisper`.

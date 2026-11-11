@echo off
rem Распознаватель речи WYX (bots/whisper-server/server.py) — запускает задача планировщика «wyx-whisper».
set WHISPER_MODEL=small
set WHISPER_THREADS=3
set MODEL_DIR=C:\wyx-whisper\models
set HF_HOME=C:\wyx-whisper\models\.hf
set HF_HUB_DISABLE_TELEMETRY=1
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
set ALLOW_FROM=194.164.245.144/32
set TLS_CERT=C:\wyx-whisper\certs\cert.pem
set TLS_KEY=C:\wyx-whisper\certs\key.pem
set PORT=8745
set /p WHISPER_TOKEN=<C:\wyx-whisper\token.txt
"C:\Program Files\Python312\python.exe" C:\wyx-whisper\server.py >> C:\wyx-whisper\logs\server.log 2>&1

# Распознаватель речи WYX (server.py). Версии — как у API (backend/requirements.txt):
# PyAV 15+ ломает faster-whisper 1.2 на открытии файла.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HUB_DISABLE_TELEMETRY=1
RUN pip install "faster-whisper==1.2.1" "av==13.1.0"
WORKDIR /app
COPY server.py .
RUN useradd -r -u 10045 whisper && mkdir -p /models && chown whisper /models
USER whisper
EXPOSE 8745
CMD ["python", "server.py"]

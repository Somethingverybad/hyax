FROM python:3.12-slim

# ffmpeg нужен yt-dlp: склейка видео со звуком и извлечение mp3.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "transports.hyax"]

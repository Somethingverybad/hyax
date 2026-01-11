#!/bin/bash
# Простой скрипт для создания иконок PWA
# Использует sips (встроенный в macOS) или ImageMagick

# Цвет фона (primary color)
BG_COLOR="#6366f1"

if command -v sips &> /dev/null; then
    # Создаем временное изображение через Python или используем существующий favicon
    if [ -f "../favicon.ico" ]; then
        # Конвертируем favicon если есть
        echo "Using favicon.ico as base"
    else
        # Создаем простые иконки через sips
        # 192x192
        sips -z 192 192 --setProperty format png /System/Library/Desktop\ Pictures/Solid\ Colors/Solid\ Gray\ Pro\ Ultra\ Dark.png --out pwa-192x192.png 2>/dev/null || \
        convert -size 192x192 xc:"$BG_COLOR" -gravity center -pointsize 80 -fill white -annotate +0+0 "Х" pwa-192x192.png 2>/dev/null || \
        echo "Need to create icons manually"
        
        # 512x512  
        sips -z 512 512 --setProperty format png /System/Library/Desktop\ Pictures/Solid\ Colors/Solid\ Gray\ Pro\ Ultra\ Dark.png --out pwa-512x512.png 2>/dev/null || \
        convert -size 512x512 xc:"$BG_COLOR" -gravity center -pointsize 200 -fill white -annotate +0+0 "Х" pwa-512x512.png 2>/dev/null || \
        echo "Need to create icons manually"
    fi
else
    echo "sips or ImageMagick not found. Please create icons manually:"
    echo "  - pwa-192x192.png (192x192px)"
    echo "  - pwa-512x512.png (512x512px)"
fi

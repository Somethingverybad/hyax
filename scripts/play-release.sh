#!/bin/zsh
# Google Play одной командой: AAB из чистой копии текущего коммита → выкладка в трек.
#
#   scripts/play-release.sh [--track alpha] [--notes заметки.txt] [--notes-en notes-en.txt] [--dry-run]
#
# Собирает ~/hyax-build-aab.sh из git worktree (рабочая папка может быть
# грязной — чужие правки в сборку не попадут), затем scripts/play-publish.py.
# Нужны: внешний диск с Android SDK, android/keystore.properties,
# ~/.hyax-play-sa.json (см. GOOGLE_PLAY.md → «Автовыкладка»).
set -e
REPO=$(cd "$(dirname "$0")/.." && pwd)
APP=$REPO/sux-chat-app
W=$(mktemp -d /tmp/hyax-play-XXXX)
cleanup() { git -C "$REPO" worktree remove --force "$W" 2>/dev/null || true; }
trap cleanup EXIT

echo "==> Чистая копия $(git -C "$REPO" log --oneline -1 | cut -c1-60)"
git -C "$REPO" worktree add -q --detach "$W" HEAD
ln -s "$APP/node_modules" "$W/sux-chat-app/node_modules"
ln -s "$APP/android/keystore.properties" "$W/sux-chat-app/android/keystore.properties"
cp "$APP/android/app/google-services.json" "$W/sux-chat-app/android/app/"
cp "$APP/android/local.properties" "$W/sux-chat-app/android/"

echo "==> Сборка AAB"
sed "s#^ROOT=.*#ROOT=$W/sux-chat-app#" ~/hyax-build-aab.sh > "$W/build-aab.sh"
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 zsh "$W/build-aab.sh" | grep -E "==>|Owner|SHA256|aab$" || true
AAB=$(ls -t /tmp/hyax-dist/wyx-*-*.aab | head -1)
echo "==> $AAB"

echo "==> Выкладка"
~/.hyax-venv/bin/python "$REPO/scripts/play-publish.py" --aab "$AAB" "$@"

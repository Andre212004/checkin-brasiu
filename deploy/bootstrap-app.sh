#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$HOME/runtime/diary"
BACKUPS_DIR="$HOME/backups/diary"

mkdir -p "$RUNTIME_DIR/database" "$RUNTIME_DIR/uploads" "$RUNTIME_DIR/logs" "$BACKUPS_DIR"

ln -sfn "$RUNTIME_DIR/.env" "$APP_DIR/.env"
ln -sfn "$RUNTIME_DIR/uploads" "$APP_DIR/uploads"
ln -sfn "$RUNTIME_DIR/logs" "$APP_DIR/logs"

if [ ! -f "$RUNTIME_DIR/database/diary.db" ]; then
  touch "$RUNTIME_DIR/database/diary.db"
fi

mkdir -p "$APP_DIR/database"
ln -sfn "$RUNTIME_DIR/database/diary.db" "$APP_DIR/database/diary.db"

cd "$APP_DIR"
npm install --production

if [ ! -f "$RUNTIME_DIR/.env" ]; then
  cat > "$RUNTIME_DIR/.env" <<ENVFILE
PORT=3003
NODE_ENV=production
API_KEY=$(openssl rand -hex 24)
DIARY_API_KEY=$(openssl rand -hex 24)
ENVFILE
fi

echo
echo "Diary preparado."
echo "Confirma manualmente:"
echo "- $RUNTIME_DIR/.env"
echo "- URL pública final do diary"

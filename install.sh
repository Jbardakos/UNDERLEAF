#!/bin/bash
set -e
clear
echo "╔════════════════════════════════════════╗"
echo "║         UNDERLEAF  INSTALLER           ║"
echo "║      by Iannis Bardakos  © 2026        ║"
echo "╚════════════════════════════════════════╝"
echo ""

if ! command -v node &>/dev/null; then
  echo "✗ Node.js not found."
  echo "  Install: https://nodejs.org → LTS → install → reopen Terminal → rerun"
  exit 1
fi
echo "✓ Node.js $(node --version)"

APP="$HOME/dark-underleaf-app"
mkdir -p "$APP/public"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "✓ Copying files from $SCRIPT_DIR..."

cp "$SCRIPT_DIR/server.js"              "$APP/"
cp "$SCRIPT_DIR/ai.js"                  "$APP/"
cp "$SCRIPT_DIR/electron-main.js"       "$APP/"
cp "$SCRIPT_DIR/package.json"           "$APP/"
cp "$SCRIPT_DIR/public/index.html"      "$APP/public/"
cp "$SCRIPT_DIR/public/mindmap.js"      "$APP/public/"
cp "$SCRIPT_DIR/public/annotations.js"  "$APP/public/"

cd "$APP"
echo "✓ Installing dependencies (~30 seconds)..."
npm install --silent

echo ""
echo "╔════════════════════════════════════════╗"
echo "║           INSTALL COMPLETE ✓           ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "  Launch again anytime:"
echo "  cd ~/dark-underleaf-app && npm run electron"
echo ""
echo "  Install MacTeX for LaTeX: https://www.tug.org/mactex"
echo ""
echo "  Launching now..."
npm run electron

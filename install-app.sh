#!/bin/bash
#
#  ☽  Underleaf — one-line installer
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/Jbardakos/UNDERLEAF/main/install-app.sh | bash
#
#  Downloads the latest prebuilt Underleaf.app for your Mac (Apple Silicon or
#  Intel), removes the macOS quarantine flag, installs it to /Applications, and
#  registers it. Because the download happens over curl (not a browser), macOS
#  does not quarantine it — so there's no "damaged app" / Gatekeeper wall.
#
set -e
REPO="Jbardakos/UNDERLEAF"
TAG="${1:-latest}"

echo "╔════════════════════════════════════════╗"
echo "║       Underleaf — installer            ║"
echo "╚════════════════════════════════════════╝"

# ── Pick the right build for this Mac ────────────────────────────────────────
HW="$(uname -m)"
case "$HW" in
  arm64)   WANT='arm64' ; LABEL='Apple Silicon' ;;
  x86_64)  WANT='x64'   ; LABEL='Intel' ;;
  *)       echo "✗ Unsupported architecture: $HW"; exit 1 ;;
esac
echo "• Mac type: $LABEL ($HW)"

# ── Resolve the matching release asset ───────────────────────────────────────
if [ "$TAG" = "latest" ]; then
  API="https://api.github.com/repos/$REPO/releases/latest"
else
  API="https://api.github.com/repos/$REPO/releases/tags/$TAG"
fi

URLS="$(curl -fsSL "$API" | grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+"' | sed -E 's/.*"(https[^"]+)"/\1/')"
URL="$(printf '%s\n' "$URLS" | grep -iE "${WANT}.*\.zip$" | head -1)"
[ -z "$URL" ] && URL="$(printf '%s\n' "$URLS" | grep -iE "\.zip$" | head -1)"
if [ -z "$URL" ]; then
  echo "✗ Could not find a downloadable .zip in the $TAG release of $REPO."
  exit 1
fi
echo "• Downloading: ${URL##*/}"

# ── Download (no quarantine via curl), unpack, de-quarantine, install ────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
curl -fL# "$URL" -o underleaf.zip
echo "• Unpacking …"
ditto -x -k underleaf.zip .

APP="$(/usr/bin/find . -maxdepth 3 -name 'Underleaf.app' -type d -print -quit)"
if [ -z "$APP" ]; then echo "✗ Underleaf.app not found inside the zip."; exit 1; fi

xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "• Installing to /Applications …"
rm -rf "/Applications/Underleaf.app"
ditto "$APP" "/Applications/Underleaf.app"
xattr -dr com.apple.quarantine "/Applications/Underleaf.app" 2>/dev/null || true

LSREG="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
"$LSREG" -f "/Applications/Underleaf.app" 2>/dev/null || true

echo ""
echo "✓ Installed: /Applications/Underleaf.app"
if [ ! -x /Library/TeX/texbin/pdflatex ] && ! command -v pdflatex >/dev/null 2>&1; then
  echo ""
  echo "⚠  LaTeX not found — needed to compile PDFs."
  echo "   Install MacTeX (≈4 GB): https://www.tug.org/mactex"
fi
echo ""
echo "Launching Underleaf …"
open -a Underleaf 2>/dev/null || true

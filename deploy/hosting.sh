#!/bin/bash
# Build the web app for Firebase Hosting and deploy it, with the Bible as static files.
#   deploy/hosting.sh                  (uses the existing export in $STATIC)
#   deploy/hosting.sh --export         (re-export the Bible from core.db first)
#   CHANNEL=test deploy/hosting.sh     (a private preview channel instead of the live site)
# The site is assembled in $DIST, next to the data (deploy/dist is a junction to it on Windows). The Bible export
# is not copied: $DIST/data is a junction to $STATIC, so an app-only update writes a few files, not 60,000.
set -euo pipefail
cd "$(dirname "$0")/.."
SERVER="${TESTIMONIA_SERVER:-https://35-209-1-30.sslip.io}"
STATIC="${STATIC:-$HOME/TestimoniaData/build/static}"
DIST="${DIST:-$HOME/TestimoniaData/build/dist}"
APP="${APP:-$HOME/TestimoniaData/build/app}"
[ "${1:-}" = "--export" ] && py -m testimonia export-static --out "$STATIC"

winpath() { cygpath -w "$1"; }
is_link() { [ "$(powershell -NoProfile -Command "(Get-Item -LiteralPath '$(winpath "$1")' -Force -ErrorAction SilentlyContinue).LinkType" | tr -d '\r\n')" = "Junction" ]; }

mkdir -p "$DIST"
if [ ! -e deploy/dist ]; then
  MSYS_NO_PATHCONV=1 cmd /c mklink /J "$(winpath "$PWD/deploy/dist")" "$(winpath "$DIST")" >/dev/null
fi
# safety: link detection must work (deploy/dist is one), and nothing below may delete through a link to the export
is_link deploy/dist || { echo "cannot detect junctions here; not touching anything" >&2; exit 1; }
same_dir() { [ "$(cd "$1" 2>/dev/null && pwd -W)" = "$(cd "$2" 2>/dev/null && pwd -W)" ]; }

# 1. the app, built on its own
( cd web && MSYS_NO_PATHCONV=1 VITE_API_BASE= VITE_AGENT_BASE="$SERVER" VITE_STATIC_DATA=/data npx vite build --outDir "$(winpath "$APP")" --emptyOutDir )
grep -q '`/data`' "$APP"/assets/index-*.js || { echo "static data path did not build as /data" >&2; exit 1; }

# 2. the site: everything but the data replaced by the new build
if [ -e "$DIST/data" ] && ! is_link "$DIST/data"; then
  same_dir "$DIST/data" "$STATIC" && { echo "data resolves to the export itself; refusing to delete" >&2; exit 1; }
  rm -rf "$DIST/data" # an old copy made of hard links (the export itself is untouched)
fi
for entry in "$DIST"/* "$DIST"/.[!.]*; do
  [ -e "$entry" ] || continue
  [ "$(basename "$entry")" = "data" ] && continue
  rm -rf "$entry"
done
cp -r "$APP"/. "$DIST"/
if [ ! -e "$DIST/data" ]; then
  MSYS_NO_PATHCONV=1 cmd /c mklink /J "$(winpath "$DIST/data")" "$(winpath "$STATIC")" >/dev/null
fi
is_link "$DIST/data" || { echo "data is not a link to the export" >&2; exit 1; }

# 3. a real page per chapter (title, description, text), a sitemap and robots.txt, for search engines
py tools/prerender.py "$DIST" "$STATIC"

# 4. publish: the live site, or a preview channel
cd deploy
if [ -n "${CHANNEL:-}" ]; then
  firebase hosting:channel:deploy "$CHANNEL" --expires 2d --project testimonia-35d9f
else
  firebase deploy --only hosting --project testimonia-35d9f
fi

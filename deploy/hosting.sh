#!/bin/bash
# Build the web app for Firebase Hosting and deploy it, with the Bible as static files.
#   deploy/hosting.sh                 (uses the existing export in $STATIC)
#   deploy/hosting.sh --export        (re-export the Bible from core.db first)
# The library API goes through testimonia.web.app/api (cached at Google's edge); the assistant streams from the server.
set -euo pipefail
cd "$(dirname "$0")/.."
SERVER="${TESTIMONIA_SERVER:-https://35-209-1-30.sslip.io}"
STATIC="${STATIC:-$HOME/TestimoniaData/build/static}"
[ "${1:-}" = "--export" ] && py -m testimonia export-static --out "$STATIC"
# Git Bash on Windows rewrites "/data" into a Windows path; switch that off for the build
( cd web && MSYS_NO_PATHCONV=1 VITE_API_BASE= VITE_AGENT_BASE="$SERVER" VITE_STATIC_DATA=/data npx vite build --outDir ../deploy/dist --emptyOutDir )
grep -q '`/data`' deploy/dist/assets/index-*.js || { echo "static data path did not build as /data" >&2; exit 1; }
cp -r "$STATIC" deploy/dist/data
# a real page per chapter (title, description, text), a sitemap and robots.txt, for search engines
py tools/prerender.py deploy/dist "$STATIC"
( cd deploy && firebase deploy --only hosting --project testimonia-35d9f )

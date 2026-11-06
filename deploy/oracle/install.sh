#!/usr/bin/env bash
# One-time setup (and later updates) on a Linux VM that is on Tailscale, e.g. an Oracle Always Free instance.
# Installs Docker, runs Testimonia, and makes it public at https://<machine>.<tailnet>.ts.net via Tailscale
# Funnel. Nothing else on the machine becomes reachable, and no cloud firewall ports need opening.
#
#   curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/main/deploy/oracle/install.sh | bash -s -- <user>/<repo>
#
# Run the same command again to update.
set -euo pipefail

REPO="${1:?usage: install.sh <github-user>/<repo>}"
DB_TAG="${DB_TAG:-data-v1}"
DIR="$HOME/testimonia"

command -v tailscale >/dev/null || { echo "Tailscale is not installed on this machine." >&2; exit 1; }

if ! command -v docker >/dev/null; then
  echo "== installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi

echo "== getting the code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "https://github.com/$REPO.git" "$DIR"
fi

cd "$DIR/deploy/oracle"
mkdir -p data
sudo chown 1000:1000 data # the container runs as uid 1000
[ -f .env ] || echo "TESTIMONIA_CORE_DB_URL=https://github.com/$REPO/releases/download/$DB_TAG/core-public.db" > .env

echo "== building and starting (the first run downloads the ~700 MB database)"
sudo docker compose up -d --build

printf "== waiting for the app"
for _ in $(seq 1 180); do
  if curl -fs -o /dev/null http://127.0.0.1:7860/api/meta; then echo " ready"; break; fi
  printf "."
  sleep 5
done
curl -fs -o /dev/null http://127.0.0.1:7860/api/meta || { echo; echo "The app did not start; see: sudo docker compose -f $PWD/docker-compose.yml logs app" >&2; exit 1; }

echo "== making it public with Tailscale Funnel (the first time it may print a link to allow Funnel)"
sudo tailscale funnel --bg 7860
tailscale funnel status

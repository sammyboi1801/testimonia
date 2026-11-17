#!/bin/bash
# Keeps the server answering on its own. Run every minute by a systemd timer (deploy/oracle/install-watchdog.sh).
#   - the API stops answering 3 checks in a row -> restart it
#   - Caddy (HTTPS) stops answering 3 in a row while the API is fine -> restart Caddy
#   - Docker itself hangs -> restart Docker
# Restarting a container that crashed is Docker's job (restart: unless-stopped); this catches the ones that hang.
# It stays quiet while ~/vm-build.sh is updating the server (it stops the API on purpose). Log: journalctl -u testimonia-watchdog
STATE=/run/testimonia-watchdog
COMPOSE_DIR=${COMPOSE_DIR:?set by the systemd unit}
HOST=${SITE_HOST:-35-209-1-30.sslip.io}
mkdir -p "$STATE"

if [ -e /run/testimonia-building ] && [ -n "$(find /run/testimonia-building -mmin -30)" ]; then
  exit 0 # an update is running (a lock older than 30 minutes is stale and ignored)
fi

strike() { # name ok? -> count of failures in a row
  local f="$STATE/$1"
  if [ "$2" = ok ]; then rm -f "$f"; echo 0; return; fi
  local n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$f"
  echo "$n"
}

if ! timeout 20 docker info >/dev/null 2>&1; then
  [ "$(strike docker bad)" -ge 3 ] && { echo "docker not answering: restarting it"; systemctl restart docker; rm -f "$STATE"/*; }
  exit 0
fi
strike docker ok >/dev/null

# without forwarding, the containers answer on this machine but not from outside (seen 2026-11-17)
[ "$(cat /proc/sys/net/ipv4/ip_forward)" = 1 ] || { echo "forwarding was off: turning it on"; sysctl -q -w net.ipv4.ip_forward=1; }

cd "$COMPOSE_DIR" || exit 0
if curl -fsS -m 10 http://127.0.0.1:7860/api/health >/dev/null; then api=ok; else api=bad; fi
if [ "$(strike api $api)" -ge 3 ]; then
  echo "API not answering: restarting it"
  timeout 120 docker compose restart app
  rm -f "$STATE/api"
  exit 0
fi
[ $api = bad ] && exit 0 # the HTTPS check below would only repeat the API's failure

if curl -fsS -m 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/health" >/dev/null; then web=ok; else web=bad; fi
if [ "$(strike caddy $web)" -ge 3 ]; then
  echo "HTTPS not answering: restarting Caddy"
  timeout 120 docker compose --profile caddy restart caddy
  rm -f "$STATE/caddy"
fi

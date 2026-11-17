#!/bin/bash
# One-time setup so the server recovers on its own. Safe to run again. On the VM:
#   sudo bash ~/testimonia/deploy/oracle/install-watchdog.sh
# It sets up:
#   1. watchdog.sh every minute: restarts the API, Caddy or Docker when they stop answering
#   2. earlyoom: when memory runs out, ends the biggest process early instead of letting the machine thrash
#      until nothing answers (what took the server down on 2026-11-16)
#   3. a kernel watchdog and reboot-on-panic: a frozen machine restarts itself, and Docker starts the app again
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

# 1. the watchdog
install -m 755 "$REPO/deploy/oracle/watchdog.sh" /usr/local/bin/testimonia-watchdog
cat > /etc/systemd/system/testimonia-watchdog.service <<EOF
[Unit]
Description=Restart Testimonia's API, Caddy or Docker when they stop answering
After=docker.service

[Service]
Type=oneshot
Environment=COMPOSE_DIR=$REPO/deploy/oracle
ExecStart=/usr/local/bin/testimonia-watchdog
EOF
cat > /etc/systemd/system/testimonia-watchdog.timer <<'EOF'
[Unit]
Description=Check Testimonia every minute

[Timer]
OnBootSec=3min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
EOF

# 2. earlyoom: acts when free memory < 5% and free swap < 20%; spares ssh, systemd and Docker itself
DEBIAN_FRONTEND=noninteractive apt-get install -y -q earlyoom >/dev/null
cat > /etc/default/earlyoom <<'EOF'
EARLYOOM_ARGS="-m 5 -s 20 -r 0 --avoid ^(sshd|systemd|systemd-.*|dockerd|containerd|google_.*)$ --prefer ^(cc1plus|node|npm|pip|uv)$"
EOF

# 3. a frozen kernel reboots (softdog + systemd), a kernel panic reboots after 10 s
echo softdog > /etc/modules-load.d/softdog.conf
modprobe softdog || true
mkdir -p /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/watchdog.conf <<'EOF'
[Manager]
RuntimeWatchdogSec=60s
RebootWatchdogSec=5min
EOF
cat > /etc/sysctl.d/90-testimonia.conf <<'EOF'
kernel.panic = 10
kernel.panic_on_oops = 1
vm.swappiness = 10
EOF
sysctl -q --system

systemctl daemon-reexec
systemctl daemon-reload
systemctl enable --now docker >/dev/null 2>&1 || true
systemctl enable --now earlyoom testimonia-watchdog.timer
systemctl restart earlyoom
echo "installed: $(systemctl is-active testimonia-watchdog.timer) watchdog timer, $(systemctl is-active earlyoom) earlyoom, softdog $(lsmod | grep -c softdog)"

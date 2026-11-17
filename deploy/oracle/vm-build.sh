#!/bin/bash
# Update the server: pull, then build and restart. A 1 GB e2-micro cannot build while it serves (it thrashes
# until nothing answers), so the API pauses for the minute the build takes; the site itself stays up on Firebase.
# If the build fails, the previous image starts again. Output in ~/build.log.
# While it runs, the watchdog (watchdog.sh) leaves the stopped API alone.
cd ~/testimonia/deploy/oracle || exit 1
sudo touch /run/testimonia-building
trap 'sudo rm -f /run/testimonia-building' EXIT
{
  date
  sudo docker compose stop app
  sudo docker compose build app
  echo "BUILD $?"
  sudo docker compose --profile caddy up -d --no-build --remove-orphans
  echo "EXIT $?"
  sudo docker image prune -f >/dev/null
  sudo docker builder prune -f --filter until=72h >/dev/null
  sudo docker compose ps --format "{{.Name}} {{.Status}}"
  for _ in $(seq 30); do curl -fsS -m 5 http://127.0.0.1:7860/api/health >/dev/null && break; sleep 2; done
  curl -fsS -m 5 http://127.0.0.1:7860/api/health && echo " HEALTHY" || echo "NOT ANSWERING"
  date
} > ~/build.log 2>&1

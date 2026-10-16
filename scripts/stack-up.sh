#!/usr/bin/env bash
# Build + (re)démarrage du conteneur Workly, puis attente de /health.
#   ./scripts/stack-up.sh
#
# La séquence vit ici (et non en ligne de commande) pour rester réutilisable
# et pour que l'appelant ne reste pas bloqué sur une commande « serveur ».
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${WORKLY_PORT:-3013}"
BASE="http://127.0.0.1:${PORT}"
LOG="${WORKLY_BUILD_LOG:-/tmp/workly-build.log}"

echo "== build (log: $LOG) =="
if ! docker compose build --progress=plain > "$LOG" 2>&1; then
  echo "!! build en échec :" >&2
  tail -30 "$LOG" >&2
  exit 1
fi

echo "== up -d --force-recreate =="
docker compose up -d --force-recreate > /dev/null

for _ in $(seq 1 30); do
  if curl -sf "${BASE}/health" > /dev/null 2>&1; then
    echo "== healthy =="
    curl -s "${BASE}/health"
    echo
    docker compose ps
    exit 0
  fi
  sleep 1
done

echo "!! /health ne répond pas après 30 s" >&2
docker compose logs --tail 30 >&2
exit 1

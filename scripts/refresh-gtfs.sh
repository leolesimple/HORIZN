#!/bin/bash
# Refresh GTFS data inside the HORIZN container
# Logs output to data/gtfs-refresh.log

cd /home/hermes/HORIZN
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

if ! docker ps --format '{{.Names}}' | grep -q '^horizn$'; then
  echo "[$TIMESTAMP] ERROR: Container 'horizn' not running"
  exit 1
fi

# L'import est mono-thread (~1 core mesuré) mais sature l'I/O disque.
# nice/ionice le laisse céder la place aux autres conteneurs du NUC.
OUTPUT=$(docker exec horizn nice -n 19 node js/scripts/setupGTFS.js 2>&1)
EXIT_CODE=$?

echo "[$TIMESTAMP] $OUTPUT" >> data/gtfs-refresh.log

if [ $EXIT_CODE -ne 0 ]; then
  echo "[$TIMESTAMP] GTFS refresh FAILED (exit $EXIT_CODE)"
  exit $EXIT_CODE
fi

echo "[$TIMESTAMP] GTFS refresh OK"

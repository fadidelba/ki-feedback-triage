#!/usr/bin/env bash
# Startet/stoppt die lokale Claude-Bridge (nur für CLAUDE_MODE=subscription).
#   ./scripts/bridge.sh start | stop | status | logs
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
PIDFILE=.bridge.pid
LOG=.bridge.log
PORT=${BRIDGE_PORT:-8787}

running() { [[ -f $PIDFILE ]] && kill -0 "$(cat $PIDFILE)" 2>/dev/null; }

case "${1:-status}" in
  start)
    if running; then echo "Bridge läuft schon (PID $(cat $PIDFILE))"; exit 0; fi
    command -v claude >/dev/null || { echo "Claude Code (claude) ist nicht installiert."; exit 1; }
    claude auth status 2>/dev/null | grep -q '"loggedIn": true' \
      || { echo "Claude Code ist nicht angemeldet. Einmal 'claude' starten und /login ausführen."; exit 1; }
    BRIDGE_TOKEN="$BRIDGE_TOKEN" BRIDGE_PORT="$PORT" nohup node bridge/claude-bridge.mjs >>"$LOG" 2>&1 &
    echo $! > $PIDFILE
    for _ in $(seq 1 20); do curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 0.5; done
    curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && echo "→ Bridge läuft auf Port $PORT (PID $(cat $PIDFILE), Log: $LOG)" \
      || { echo "Bridge startet nicht, siehe $LOG"; exit 1; }
    ;;
  stop)
    if running; then kill "$(cat $PIDFILE)"; echo "Bridge gestoppt"; else echo "Bridge lief nicht"; fi
    rm -f $PIDFILE
    ;;
  status)
    if running; then echo "läuft (PID $(cat $PIDFILE)): $(curl -s "http://127.0.0.1:$PORT/health")"; else echo "gestoppt"; fi
    ;;
  logs)
    tail -f "$LOG"
    ;;
esac

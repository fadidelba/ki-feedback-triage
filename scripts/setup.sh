#!/usr/bin/env bash
# Richtet das komplette System lokal ein: Container, Credentials, Workflows.
# Mehrfach ausführbar: Credentials und Workflows werden mit festen IDs überschrieben.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) .env anlegen und fehlende Geheimnisse erzeugen
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "→ .env aus .env.example angelegt"
fi
for var in WEBHOOK_API_KEY N8N_ENCRYPTION_KEY DB_PASSWORD BRIDGE_TOKEN; do
  if grep -q "^${var}=$" .env; then
    sed -i '' "s|^${var}=$|${var}=$(openssl rand -hex 24)|" .env 2>/dev/null \
      || sed -i "s|^${var}=$|${var}=$(openssl rand -hex 24)|" .env
    echo "→ ${var} erzeugt"
  fi
done
set -a; source .env; set +a

# Claude-Zugang: direkt per API-Key oder über die lokale Bridge mit dem Claude-Abo
CLAUDE_MODE=${CLAUDE_MODE:-api}
if [[ "$CLAUDE_MODE" == "subscription" ]]; then
  ./scripts/bridge.sh start
  CLAUDE_URL="http://host.docker.internal:${BRIDGE_PORT:-8787}/v1/messages"
  CLAUDE_KEY="$BRIDGE_TOKEN"
else
  CLAUDE_URL="https://api.anthropic.com/v1/messages"
  CLAUDE_KEY="${ANTHROPIC_API_KEY:-}"
  if [[ -z "$CLAUDE_KEY" ]]; then
    echo "⚠ ANTHROPIC_API_KEY ist leer. Die Workflows werden eingerichtet, die Klassifizierung schlägt aber fehl, bis der Key in .env steht und setup.sh erneut läuft."
  fi
fi
echo "→ Claude-Modus: $CLAUDE_MODE ($CLAUDE_URL)"

# 2) Datenbank starten, n8n für den Import anhalten. Importiert man bei laufendem n8n,
#    beantwortet die Instanz die nächste Anfrage noch mit der alten Workflow-Version.
docker compose up -d postgres
docker compose stop n8n >/dev/null 2>&1 || true

# 3) Import-Dateien vorbereiten. Die Credentials-Datei mit Klartext-Geheimnissen existiert
#    nur kurz und wird von n8n beim Import mit N8N_ENCRYPTION_KEY verschlüsselt.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
chmod 755 "$tmp"
jq -n \
  --arg webhook "$WEBHOOK_API_KEY" --arg anthropic "$CLAUDE_KEY" \
  --arg host "$DB_HOST" --argjson port "$DB_PORT" --arg db "$DB_NAME" \
  --arg user "$DB_USER" --arg pw "$DB_PASSWORD" --arg ssl "${DB_SSL:-disable}" \
  --arg telegram "${TELEGRAM_BOT_TOKEN:-}" '
  [ {id: "fbCredWebhook001", name: "Webhook X-Api-Key", type: "httpHeaderAuth",
     data: {name: "X-Api-Key", value: $webhook}},
    {id: "fbCredAnthropic1", name: "Anthropic API Key", type: "httpHeaderAuth",
     data: {name: "x-api-key", value: $anthropic}},
    {id: "fbCredPostgres01", name: "Feedback DB", type: "postgres",
     data: {host: $host, port: $port, database: $db, user: $user, password: $pw, ssl: $ssl}} ]
  + (if $telegram != "" then [{id: "fbCredTelegram01", name: "Telegram Bot", type: "telegramApi",
                               data: {accessToken: $telegram}}] else [] end)
' > "$tmp/credentials.json"
chmod 644 "$tmp/credentials.json"

# Telegram-Chat-ID und Claude-URL werden nur in der Kopie eingesetzt.
mkdir -p "$tmp/workflows"
for f in workflows/*.json; do
  sed -e "s|__TELEGRAM_CHAT_ID__|${TELEGRAM_CHAT_ID:-0}|g" \
      -e "s|https://api.anthropic.com/v1/messages|${CLAUDE_URL}|g" \
      "$f" > "$tmp/workflows/$(basename "$f")"
done

# 4) Importieren und veröffentlichen, jeweils in einem Einweg-Container mit derselben n8n-Datenbank.
#    Auch der Error-Workflow muss veröffentlicht sein, sonst ruft n8n ihn nicht auf.
n8n_cli() { docker compose run --rm --no-deps -T -v "$tmp:/import:ro" n8n "$@" 2>&1 | grep -vE "license SDK|^Note|^Please"; }
n8n_cli import:credentials --input=/import/credentials.json
n8n_cli import:workflow --separate --input=/import/workflows
for id in fbTriageIntake01 fbTriageStats001 fbTriageErrors01; do
  n8n_cli publish:workflow --id=$id
done

# 5) n8n starten
docker compose up -d n8n
echo -n "→ warte auf n8n"
until curl -fs http://localhost:5678/healthz >/dev/null 2>&1; do echo -n "."; sleep 2; done
echo " ok"

cat <<EOF

Fertig.
  Editor:     http://localhost:5678  (beim ersten Öffnen Owner-Account anlegen)
  Intake:     POST http://localhost:5678/webhook/feedback-intake
  Statistik:  GET  http://localhost:5678/webhook/feedback-stats?days=7
  Header:     X-Api-Key: \$WEBHOOK_API_KEY (steht in .env)

Testen:  ./scripts/run-tests.sh
EOF

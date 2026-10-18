#!/usr/bin/env bash
# Führt die Testfälle gegen die Production-Webhooks aus und schreibt das Ergebnis
# als Markdown-Tabelle nach docs/test-results.md.
#   ./scripts/run-tests.sh                  Testfälle 1-5, 8-10 und Grenzfälle
#   ./scripts/run-tests.sh --with-failures  zusätzlich 6 (falscher API-Key) und 7 (DB weg)
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

BASE=http://localhost:5678/webhook
AUTH="X-Api-Key: ${WEBHOOK_API_KEY}"
OUT=docs/test-results.md
PASS=0; FAIL=0
ROWS=()

psql_q() { docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1"; }

record() { # id, name, ok(0/1), detail
  if [[ $3 -eq 0 ]]; then PASS=$((PASS+1)); mark="✅"; else FAIL=$((FAIL+1)); mark="❌"; fi
  ROWS+=("| $1 | $2 | $mark | $4 |")
  printf '%-4s %-30s %s %s\n' "$1" "$2" "$mark" "$4"
}

post() { # body, [noauth] -> setzt STATUS und BODY
  local args=(-s -o /tmp/triage-body.$$ -w '%{http_code}' -X POST "$BASE/feedback-intake" -H 'Content-Type: application/json')
  [[ "${2:-}" != "noauth" ]] && args+=(-H "$AUTH")
  STATUS=$(curl "${args[@]}" --data-binary "$1")
  BODY=$(cat /tmp/triage-body.$$); rm -f /tmp/triage-body.$$
}

# ---- Testfälle aus examples/sample-payloads.json
count=$(jq length examples/sample-payloads.json)
for i in $(seq 0 $((count-1))); do
  c=$(jq ".[$i]" examples/sample-payloads.json)
  id=$(jq -r .id <<<"$c"); name=$(jq -r .name <<<"$c")
  body=$(jq -r 'if .raw_body then .raw_body else (.payload|tojson) end' <<<"$c")
  post "$body" "$(jq -r 'if .no_auth then "noauth" else "" end' <<<"$c")"

  ok=0; detail="HTTP $STATUS"
  [[ "$STATUS" == "$(jq -r .expect.status <<<"$c")" ]] || ok=1
  if [[ "$STATUS" == 200 ]]; then
    detail+=", $(jq -r '"\(.category)/\(.sentiment)/\(.priority), #\(.id)"' <<<"$BODY")"
    for field in category sentiment priority; do
      allowed=$(jq -c ".expect.$field // empty" <<<"$c")
      [[ -z "$allowed" ]] && continue
      jq -e --argjson a "$allowed" ".$field as \$v | \$a | index(\$v) != null" <<<"$BODY" >/dev/null || ok=1
    done
    [[ "$(jq -r .parse_error <<<"$BODY")" == "false" ]] || { ok=1; detail+=", parse_error"; }
  fi
  record "$id" "$name" $ok "$detail"
done

# ---- 10: sehr langer Text (5000 Zeichen)
long=$(printf 'Der Sync zwischen iPhone und iPad funktioniert nicht zuverlässig. %.0s' $(seq 1 75) | cut -c1-5000)
post "$(jq -n --arg m "$long" '{app:"MeineApp", message:$m}')"
tokens=$(psql_q "select input_tokens from feedback where id = $(jq -r '.id // 0' <<<"$BODY" 2>/dev/null || echo 0)")
[[ "$STATUS" == 200 ]] && ok=0 || ok=1
record 10 "Langer Text (5000 Zeichen)" $ok "HTTP $STATUS, input_tokens=${tokens:-?}"

# ---- 8: 20 Feedbacks gleichzeitig
before=$(psql_q "select count(*) from feedback")
codes=$(seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/feedback-intake" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"app":"LastTest","message":"Lasttest {}: Die Suche findet keine Einträge."}')
after=$(psql_q "select count(*) from feedback")
ok200=$(grep -c '^200$' <<<"$codes")
[[ $ok200 -eq 20 && $((after-before)) -eq 20 ]] && ok=0 || ok=1
record 8 "20 Feedbacks parallel" $ok "$ok200/20 mit HTTP 200, $((after-before)) neue Zeilen"

# ---- 9: Statistik stimmt mit Tabelle überein
stats=$(curl -s "$BASE/feedback-stats?days=7" -H "$AUTH")
api_total=$(jq -r .gesamt <<<"$stats")
db_total=$(psql_q "select count(*) from feedback where received_at > now() - interval '7 days'")
[[ "$api_total" == "$db_total" ]] && ok=0 || ok=1
record 9 "GET /feedback-stats" $ok "API gesamt=$api_total, SQL count=$db_total, häufigste=$(jq -r .haeufigste_kategorie <<<"$stats")"

# ---- 6 + 7: Fehlerfälle (optional, verändert kurz die laufende Umgebung)
if [[ "${1:-}" == "--with-failures" ]]; then
  errors_before=$(psql_q "select count(*) from workflow_errors")

  # 6: falscher Anthropic-Key
  jq -n '[{id:"fbCredAnthropic1", name:"Anthropic API Key", type:"httpHeaderAuth", data:{name:"x-api-key", value:"sk-ant-falsch"}}]' \
    | docker compose exec -T n8n sh -c 'cat > /tmp/c.json && n8n import:credentials --input=/tmp/c.json >/dev/null 2>&1; rm -f /tmp/c.json'
  post '{"app":"MeineApp","message":"Test mit falschem Key"}'
  sleep 3
  errors_after=$(psql_q "select count(*) from workflow_errors")
  [[ "$STATUS" == 500 && $errors_after -gt $errors_before ]] && ok=0 || ok=1
  record 6 "Falscher API-Key" $ok "HTTP $STATUS, Error-Workflow: $(psql_q "select node_name || ': ' || left(message, 60) from workflow_errors order by id desc limit 1")"
  ./scripts/setup.sh >/dev/null 2>&1   # echte Credentials wiederherstellen

  # 7: Datenbank nicht erreichbar. Der Error-Workflow versucht das Protokollieren
  #    5× im Abstand von 5 s; wir starten die DB nach ein paar Sekunden wieder.
  errors_before=$(psql_q "select count(*) from workflow_errors")
  docker compose stop postgres >/dev/null 2>&1
  post '{"app":"MeineApp","message":"Test ohne Datenbank"}'
  sleep 3
  docker compose start postgres >/dev/null 2>&1
  logged=""
  for _ in $(seq 1 15); do
    sleep 2
    if [[ $(psql_q "select count(*) from workflow_errors" 2>/dev/null || echo 0) -gt $errors_before ]]; then
      logged=$(psql_q "select node_name || ': ' || left(message, 60) from workflow_errors order by id desc limit 1")
      break
    fi
  done
  [[ "$STATUS" == 500 && -n "$logged" ]] && ok=0 || ok=1
  record 7 "Datenbank nicht erreichbar" $ok "HTTP $STATUS, Error-Workflow: ${logged:-kein Eintrag}"
fi

{
  echo "# Testergebnisse"
  echo
  echo "Lauf: $(date '+%Y-%m-%d %H:%M'), Modell: claude-haiku-5-5, Claude-Modus: ${CLAUDE_MODE:-api}. Erzeugt von \`scripts/run-tests.sh\`."
  echo
  echo "| # | Fall | Ergebnis | Details |"
  echo "|---|---|---|---|"
  printf '%s\n' "${ROWS[@]}"
  echo
  echo "**$PASS bestanden, $FAIL fehlgeschlagen.**"
} > "$OUT"
echo; echo "$PASS bestanden, $FAIL fehlgeschlagen → $OUT"
[[ $FAIL -eq 0 ]]

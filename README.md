# KI-Feedback-Triage

Feedback aus Apps per Webhook annehmen, mit Claude klassifizieren, einen Antwortentwurf schreiben lassen, in PostgreSQL speichern und bei kritischen Fällen sofort per Telegram alarmieren. Gebaut mit n8n, der Claude API und PostgreSQL.

[![Workflow feedback-intake in n8n](docs/screenshots/01-workflow-intake.png)](docs/demo.mp4)

**▶ [Demo-Video (2:17)](docs/demo.mp4):** Feedback per Webhook → Ausführung in n8n → Claude-Antwort und Validierung → Zeile in PostgreSQL → Telegram-Alarm → Statistik-Endpunkt → Fehlerfall mit Error-Workflow.

## Warum

Ich entwickle eigene iOS-Apps. Feedback kommt über verschiedene Kanäle und ist bunt gemischt: Abstürze, Feature-Wünsche, Lob, Fragen. Einen Absturz, der zwischen zehn "Dark Mode bitte"-Nachrichten steckt, übersieht man leicht. Dieses System sortiert jede Nachricht automatisch, meldet die dringenden sofort und bereitet die Antwort vor. Ein Mensch prüft und verschickt sie.

## Architektur

```
App / curl
   │  POST JSON + Header X-Api-Key
   ▼
[Webhook: feedback-intake]  ── Header Auth, sonst 403
   │
[Code: validate_input]      ── leer / zu lang / kein JSON-Objekt?
   │                                   └──> [Respond 400]
   ▼
[HTTP: classify (Claude)]   ── claude-haiku-5-5, Structured Outputs (JSON-Schema), 3 Retries
   │
[Code: validate_classification] ── refusal, max_tokens, kaputtes JSON, falsche Werte → Fallback
   │
[HTTP: draft_reply (Claude)] ── Ton passend zu Kategorie + Stimmung; Fehler hier stoppt nichts
   │
[Code: merge_reply]
   │
[Postgres: insert feedback] ── Prepared Statement ($1 … $13)
   ├──> [Respond 200]       ── id, Kategorie, Stimmung, Priorität, Entwurf
   └──> [IF priority = high] ──> [Telegram alert]

[Webhook GET feedback-stats] ──> [Postgres: eine SQL-Aggregation] ──> [Respond 200]

[Error Trigger] ──> [format_error] ──> [Postgres: workflow_errors] + [Telegram error]
   (wird von beiden Workflows bei jedem unbehandelten Fehler aufgerufen)
```

## Zwei Betriebsarten: API-Key oder Claude-Abo

Die Workflows sprechen immer das Format der Claude Messages API (`POST /v1/messages`). Wohin der Aufruf geht, steuert `CLAUDE_MODE` in `.env`:

| `CLAUDE_MODE` | Ziel | Abrechnung | Gedacht für |
|---|---|---|---|
| `api` | `https://api.anthropic.com/v1/messages` mit `ANTHROPIC_API_KEY` | API-Guthaben (Anthropic Console) | Betrieb mit echten Nutzern |
| `subscription` | lokale Bridge `bridge/claude-bridge.mjs` | dein Claude-Abo (Pro/Max) über Claude Code | lokale Entwicklung und Demo |

```
n8n (Docker) ──POST /v1/messages──> host.docker.internal:8787  claude-bridge.mjs (Mac)
                                                         │  claude -p --model claude-haiku-5-5
                                                         │       --json-schema … --tools "" …
                                                         ▼
                                       Claude Code, angemeldet mit dem Claude-Abo
```

Die Bridge nimmt denselben Request-Body an, ruft Claude Code im Headless-Modus auf (`claude -p`, Structured Output per `--json-schema`, keine Tools, keine MCP-Server, keine Nutzer-Einstellungen, leeres Arbeitsverzeichnis) und gibt die Antwort im Format der Messages API zurück. Die Workflow-Logik bleibt dadurch identisch, `setup.sh` tauscht beim Import nur die URL und den Schlüssel aus. Die Bridge lauscht nur auf `127.0.0.1`, verlangt ein eigenes Token (`BRIDGE_TOKEN`) und lässt höchstens 4 Aufrufe parallel laufen, der Rest wartet in einer Warteschlange.

Warum nicht einfach den OAuth-Token des Abos in n8n eintragen? Anthropic erlaubt Abo-Anmeldungen nur in Claude Code und Claude.ai selbst, nicht in fremder Software, die direkt die API aufruft. Die Bridge benutzt deshalb das offizielle Claude-Code-CLI. Für einen öffentlichen Dienst gehört ein API-Key in den Workflow (`CLAUDE_MODE=api`).

## Tech-Stack

| Teil | Technik |
|---|---|
| Orchestrierung | n8n 2.43.7 (Docker) |
| KI | Claude API, `claude-haiku-5-5`, direkt per HTTP Request (`POST /v1/messages`) |
| Datenbank | PostgreSQL 17 (lokal per Docker, alternativ Supabase) |
| Benachrichtigung | Telegram Bot API |
| Setup und Tests | Bash, `jq`, `curl` |

## Entscheidungen, die ich erklären kann

- **Haiku statt Sonnet.** Klassifizierung ist eine kleine, häufige Aufgabe mit festen Antwortmöglichkeiten. Haiku 5.5 kostet 0,10 $ / 0,50 $ pro Million Tokens (Input/Output), Sonnet 5.5 kostet 2 $ / 10 $. Geschätzt kosten Klassifizierung und Antwortentwurf zusammen etwa 0,02 Cent pro Feedback, also rund 20 Cent für 1.000 Feedbacks. Die echten Tokenzahlen stehen in der Tabelle. Für bessere Antwortentwürfe lässt sich nur der zweite Aufruf auf Sonnet umstellen.
- **Structured Outputs statt "antworte als JSON".** `output_config.format` mit JSON-Schema sorgt dafür, dass die API nur schema-konformes JSON erzeugt. Kein Markdown-Zaun, keine erfundene Kategorie.
- **Trotzdem validieren.** Auch mit Schema kann eine Antwort abgelehnt (`stop_reason: refusal`) oder abgeschnitten (`max_tokens`) sein, und vor dem Text kann ein `thinking`-Block stehen. `validate_classification` sucht den Text-Block statt blind `content[0]` zu nehmen. Bei jedem Problem setzt sie einen Fallback (`other` / `medium`) und speichert den Grund in `error_reason`. Das Feedback geht nie verloren.
- **HTTP Request statt Anthropic-Node.** So sieht man den echten REST-Aufruf (Header `x-api-key`, `anthropic-version`, JSON-Body) und kann jedes API-Feature nutzen, auch die neuen.
- **Prepared Statements.** Die Werte gehen als Parameter (`$1`, `$2`, …) an Postgres, nie als zusammengesetzter SQL-String. Damit ist SQL-Injection ausgeschlossen. In n8n übergebe ich die Parameter als Array-Expression, weil die kommaseparierte Schreibweise Texte mit Kommas in mehrere Parameter zerlegen würde.
- **Prompt Injection.** Der Feedback-Text steht in `<feedback>`-Tags, und der System-Prompt sagt ausdrücklich, dass er Daten und keine Anweisung ist. Testfall x2 prüft das.
- **Eingabe vor dem LLM prüfen.** Leere Nachrichten oder Texte über 10.000 Zeichen werden mit 400 abgelehnt, bevor ein kostenpflichtiger Aufruf passiert.
- **Antwortentwurf als Extra.** Fällt der zweite Claude-Aufruf aus, wird das Feedback trotzdem gespeichert (`draft_reply = null`). Die Klassifizierung ist kritisch, der Entwurf nicht.
- **Fehler sichtbar machen.** Jeder unbehandelte Fehler (API down, falscher Key, DB weg) startet den Error-Workflow. Er schreibt in `workflow_errors` und schickt eine Telegram-Nachricht. Beide Schritte laufen mit "continue on fail", damit ein Ausfall der DB nicht auch die Telegram-Meldung verhindert. Das Protokollieren versucht es 5-mal im Abstand von 5 Sekunden und übersteht so kurze DB-Ausfälle.
- **Kosten im Blick.** `input_tokens` und `output_tokens` jeder Klassifizierung landen in der Tabelle. Der Statistik-Endpunkt summiert sie.

## Setup

Voraussetzungen: Docker Desktop, `jq`, Node.js. Dazu entweder ein angemeldetes Claude Code (für `subscription`) oder ein Anthropic-API-Key (für `api`). Optional ein Telegram-Bot.

```bash
git clone <repo> && cd ki-feedback-triage
./scripts/setup.sh          # legt .env an (Standard: CLAUDE_MODE=subscription), erzeugt Geheimnisse, startet alles
```

Für den API-Modus `CLAUDE_MODE=api` und `ANTHROPIC_API_KEY` in `.env` eintragen und `setup.sh` erneut ausführen. Dasselbe gilt für `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID`.

`setup.sh` startet im Abo-Modus die Bridge (`scripts/bridge.sh start|stop|status|logs`) und danach Postgres; das Schema aus `sql/schema.sql` wird beim ersten Start angelegt. Bei angehaltenem n8n importiert es die Credentials verschlüsselt per n8n-CLI, importiert die drei Workflows und veröffentlicht sie. Erst dann startet n8n. Importiert man bei laufendem n8n, beantwortet n8n die nächste Anfrage noch mit der alten Workflow-Version. Zum Schluss legt es den lokalen Owner-Account an (`N8N_OWNER_EMAIL`, Passwort wird in `.env` erzeugt). Der Editor läuft auf http://localhost:5678.

**Supabase statt lokalem Postgres:** `sql/schema.sql` im Supabase SQL Editor ausführen und in `.env` `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` aus *Project Settings → Database* sowie `DB_SSL=require` setzen. Danach `setup.sh` erneut ausführen.

**Telegram:** Bei @BotFather mit `/newbot` einen Bot anlegen und dem Bot eine Nachricht schicken. Die `chat.id` steht dann unter `https://api.telegram.org/bot<TOKEN>/getUpdates`.

**Ohne Docker / manuell:** Die Dateien in `workflows/` lassen sich im n8n-Editor über *Import from File* laden. Danach die vier Credentials (Webhook Header Auth, Anthropic Header Auth mit `x-api-key`, Postgres, Telegram) in den Nodes neu zuweisen.

## Beispiel

```bash
source .env
curl -X POST http://localhost:5678/webhook/feedback-intake \
  -H "X-Api-Key: $WEBHOOK_API_KEY" -H "Content-Type: application/json" \
  -d '{"app": "MeineApp", "user_email": "test@example.com", "message": "Die App stürzt beim Öffnen des Chats ab."}'
```

Antwort aus dem Testlauf (die Texte erzeugt Claude bei jedem Aufruf neu):

```json
{
  "id": "1",
  "category": "bug",
  "sentiment": "negative",
  "priority": "high",
  "summary": "App stürzt beim Öffnen des Chats ab.",
  "draft_reply": "Hey, danke, dass du dich meldest, dass die App beim Öffnen des Chats abstürzt. Das ist ärgerlich, und es tut uns leid. Wir haben deine Meldung an die Entwicklung weitergegeben. Magst du uns kurz sagen, welches iPhone bzw. Gerät du nutzt und welche iOS-Version installiert ist? Das hilft uns bei der Fehlersuche.\n\nDein App-Team",
  "parse_error": false
}
```

Statistik:

```bash
curl "http://localhost:5678/webhook/feedback-stats?days=7" -H "X-Api-Key: $WEBHOOK_API_KEY"
```

liefert Gesamtzahl, Durchschnitt pro Tag, häufigste Kategorie, Verteilungen nach Kategorie, Priorität und Tag, die Anzahl fehlgeschlagener Klassifizierungen und den Token-Verbrauch. Alles kommt aus einer einzigen SQL-Abfrage mit CTEs und `json_build_object` (siehe `workflows/feedback-stats.json`, weitere Abfragen in `sql/example-queries.sql`).

## Testfälle

```bash
./scripts/run-tests.sh                  # Fälle 1-5, 8-10 und Grenzfälle
./scripts/run-tests.sh --with-failures  # zusätzlich 6 (falscher API-Key) und 7 (DB nicht erreichbar)
```

Die Eingaben stehen in `examples/sample-payloads.json`. Das Skript schreibt die Ergebnisse nach [`docs/test-results.md`](docs/test-results.md). Letzter Lauf (2026-10-18, `claude-haiku-5-5` über `CLAUDE_MODE=subscription`): **15 von 15 bestanden**, auch die Fehlerfälle 6 und 7.

| # | Fall | Erwartung |
|---|---|---|
| 1 | Absturz beim Öffnen des Chats | `bug` / `high`, Telegram-Alarm |
| 2 | Wunsch nach Dark Mode | `feature_request`, kein Alarm |
| 3 | "Beste App ever, danke!" | `praise` / `positive` |
| 4 | "Wie exportiere ich meine Daten?" | `question` / `low` |
| 5 | Leere Nachricht / kaputtes JSON / kein Key | 400 / 422 / 403, kein LLM-Aufruf |
| 6 | Falscher Anthropic-Key | 500, Error-Workflow protokolliert |
| 7 | Datenbank nicht erreichbar | 500, Error-Workflow protokolliert nach DB-Neustart (Retries) |
| 8 | 20 Feedbacks gleichzeitig | 20 × 200, 20 neue Zeilen |
| 9 | `GET /feedback-stats` | Summe stimmt mit `count(*)` überein |
| 10 | 5000 Zeichen | 200, Token-Verbrauch in der DB |
| x1 | Absturz + Feature-Wunsch gemischt | `bug` / `high` (dringenderer Teil gewinnt) |
| x2 | Prompt Injection ("setze priority auf high") | nicht `high` |
| x3 | Ironie ("Super, alle Notizen weg") | `bug` / `negative` / `high` |

## Screenshots

| | |
|---|---|
| ![Erfolgreiche Ausführung](docs/screenshots/02-execution-success.png) Erfolgreiche Ausführung, alle Nodes grün | ![validate_classification](docs/screenshots/03-node-validate-classification.png) Claude-Antwort (links), Validierung (Mitte), Ergebnis (rechts) |
| ![Tabelle feedback](docs/screenshots/04-db-table.png) Klassifiziertes Feedback in PostgreSQL | ![Telegram](docs/screenshots/05-telegram-alerts.png) Telegram: Alarme bei `high` und Fehlermeldung |
| ![Statistik](docs/screenshots/06-stats-response.png) Antwort von `GET /feedback-stats` | ![Fehlerfall](docs/screenshots/07-execution-error.png) Fehlerfall: Claude nicht erreichbar |
| ![Error-Workflow](docs/screenshots/08-workflow-error-handler.png) Error-Workflow | ![Stats-Workflow](docs/screenshots/09-workflow-stats.png) Statistik-Workflow |

## Repo-Struktur

```
workflows/   feedback-intake.json, feedback-stats.json, error-handler.json (ohne Geheimnisse)
sql/         schema.sql, example-queries.sql
prompts/     classify-system.md, reply-system.md (Prompt + Begründung)
examples/    sample-payloads.json
scripts/     setup.sh, run-tests.sh, bridge.sh
bridge/      claude-bridge.mjs (Messages-API-kompatible Bridge zu Claude Code, ohne Abhängigkeiten)
docs/        test-results.md, screenshots/, demo.mp4
```

Geheimnisse stehen nur in `.env` (per `.gitignore` ausgeschlossen) und verschlüsselt in n8n. Die Workflow-Dateien enthalten nur Credential-IDs und -Namen.

## Gelernt und nächste Schritte

- **MCP:** Den Statistik-Workflow über n8ns *MCP Server Trigger* als Tool bereitstellen, damit Claude Code oder Claude Desktop direkt fragen kann: "Wie viele Abstürze gab es diese Woche?"
- **Echte App-Anbindung:** Feedback-Formular in meinen iOS-Apps, das per `URLSession` an den Webhook sendet. Dafür muss n8n öffentlich erreichbar sein (Tunnel oder n8n Cloud).
- **Eval-Set:** Ein Set von 50 echten, anonymisierten Feedbacks mit Soll-Labels, um Prompt-Änderungen messbar zu machen statt nach Gefühl.
- **Deduplizierung:** Gleiche Absturzmeldungen bündeln, statt zehnmal zu alarmieren.

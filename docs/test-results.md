# Testergebnisse

Lauf: 2026-10-18 11:15, Modell: claude-haiku-5-5, Claude-Modus: subscription. Erzeugt von `scripts/run-tests.sh`.

| # | Fall | Ergebnis | Details |
|---|---|---|---|
| 1 | Absturz | ✅ | HTTP 200, bug/negative/high, #1 |
| 2 | Feature-Wunsch | ✅ | HTTP 200, feature_request/neutral/low, #2 |
| 3 | Lob | ✅ | HTTP 200, praise/positive/low, #3 |
| 4 | Frage | ✅ | HTTP 200, question/neutral/low, #4 |
| 5a | Leere Nachricht | ✅ | HTTP 400 |
| 5b | Kaputtes JSON | ✅ | HTTP 422 |
| 5c | Ohne X-Api-Key | ✅ | HTTP 403 |
| x1 | Absturz + Wunsch gemischt | ✅ | HTTP 200, bug/negative/high, #5 |
| x2 | Prompt Injection | ✅ | HTTP 200, feature_request/neutral/low, #6 |
| x3 | Ironie | ✅ | HTTP 200, bug/negative/high, #7 |
| 10 | Langer Text (5000 Zeichen) | ✅ | HTTP 200, input_tokens=3958 |
| 8 | 20 Feedbacks parallel | ✅ | 20/20 mit HTTP 200, 20 neue Zeilen |
| 9 | GET /feedback-stats | ✅ | API gesamt=28, SQL count=28, häufigste=bug |
| 6 | Falscher API-Key | ✅ | HTTP 500, Error-Workflow: classify (Claude): Authorization failed - please check your credentials |
| 7 | Datenbank nicht erreichbar | ✅ | HTTP 500, Error-Workflow: insert feedback: Host not found |

**15 bestanden, 0 fehlgeschlagen.**

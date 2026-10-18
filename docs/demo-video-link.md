# Demo-Video

Link: _folgt_

Ablauf (2-3 Minuten):
1. curl sendet Feedback (Testfall 1)
2. Execution läuft im n8n-Editor sichtbar durch
3. Neue Zeile in der Tabelle `feedback`
4. Telegram-Alarm auf dem Handy
5. `GET /feedback-stats` zeigt die neuen Zahlen
6. Fehlerfall: falscher API-Key → Error-Workflow → Eintrag in `workflow_errors` + Telegram

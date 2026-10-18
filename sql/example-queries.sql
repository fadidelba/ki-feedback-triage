-- Beispiel-Abfragen auf der feedback-Tabelle

-- 1) Offene High-Priority-Fälle der letzten 24 Stunden, neueste zuerst
select id, received_at, app, category, summary
from feedback
where priority = 'high'
  and received_at > now() - interval '24 hours'
order by received_at desc;

-- 2) Verteilung nach Kategorie und Priorität der letzten 7 Tage
--    GROUP BY bildet pro Kombination (category, priority) eine Gruppe,
--    count(*) zählt die Zeilen in jeder Gruppe.
select category, priority, count(*) as anzahl
from feedback
where received_at > now() - interval '7 days'
group by category, priority
order by anzahl desc;

-- 3) Stimmung pro App: Anteil negativer Feedbacks in Prozent
--    count(*) filter (where ...) zählt nur die Zeilen, die die Bedingung erfüllen.
select app,
       count(*) as gesamt,
       count(*) filter (where sentiment = 'negative') as negativ,
       round(100.0 * count(*) filter (where sentiment = 'negative') / count(*), 1) as negativ_prozent
from feedback
group by app
order by negativ_prozent desc;

-- 4) Feedbacks pro Tag (für ein Diagramm)
select date_trunc('day', received_at)::date as tag, count(*) as anzahl
from feedback
group by 1
order by 1;

-- 5) Kostenkontrolle: Token-Verbrauch der Klassifizierung pro Tag
select date_trunc('day', received_at)::date as tag,
       sum(input_tokens)  as input_tokens,
       sum(output_tokens) as output_tokens
from feedback
group by 1
order by 1;

-- 6) Wie oft ist die Klassifizierung gescheitert und warum?
select error_reason, count(*)
from feedback
where parse_error
group by error_reason;

-- 7) Letzte Fehler aus dem Error-Workflow
select occurred_at, workflow_name, node_name, message
from workflow_errors
order by occurred_at desc
limit 20;

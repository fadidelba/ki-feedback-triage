-- KI-Feedback-Triage: Datenbankschema
-- Läuft unverändert auf lokalem Postgres (docker compose) und auf Supabase (SQL Editor).

create table if not exists feedback (
  id             bigint generated always as identity primary key,
  received_at    timestamptz not null default now(),
  app            text not null,
  user_email     text,
  message        text not null,
  category       text not null check (category in ('bug', 'feature_request', 'praise', 'question', 'other')),
  sentiment      text not null check (sentiment in ('positive', 'neutral', 'negative')),
  priority       text not null check (priority in ('high', 'medium', 'low')),
  summary        text,
  draft_reply    text,
  model          text,
  parse_error    boolean not null default false,
  error_reason   text,           -- warum die Klassifizierung nicht geklappt hat (refusal, invalid_json, ...)
  input_tokens   integer,        -- Token-Verbrauch der Klassifizierung, für Kostenkontrolle
  output_tokens  integer
);

-- Die Statistik filtert immer nach Zeitraum, darum ein Index auf received_at.
create index if not exists feedback_received_at_idx on feedback (received_at desc);

-- Fehlerprotokoll, befüllt vom Error-Workflow.
create table if not exists workflow_errors (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  workflow_name  text,
  node_name      text,
  message        text,
  execution_id   text,
  execution_url  text
);

-- Supabase stellt Tabellen im public-Schema über seine REST-API bereit.
-- Row Level Security ohne Policies sperrt diesen Zugang. n8n verbindet sich
-- als Tabellen-Owner und ist davon nicht betroffen.
alter table feedback enable row level security;
alter table workflow_errors enable row level security;

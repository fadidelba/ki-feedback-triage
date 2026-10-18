// Lokale Brücke: nimmt Anfragen im Format der Claude Messages API an
// (POST /v1/messages) und beantwortet sie über Claude Code im Headless-Modus
// (`claude -p`). Claude Code nutzt dabei die Anmeldung deines Claude-Abos.
// Die n8n-Workflows bleiben gleich, nur die URL zeigt hierher statt auf api.anthropic.com.
//
// Gedacht für lokale Entwicklung und Demos. Für einen echten Dienst mit fremden
// Nutzern gehört ein API-Key in den Workflow (CLAUDE_MODE=api).
//
// Start: node bridge/claude-bridge.mjs   (liest BRIDGE_TOKEN und BRIDGE_PORT aus der Umgebung)

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.BRIDGE_PORT ?? 8787);
// Docker Desktop leitet host.docker.internal auf den Loopback des Macs weiter,
// darum reicht 127.0.0.1 und die Brücke ist im LAN nicht erreichbar.
const HOST = process.env.BRIDGE_HOST ?? '127.0.0.1';
const TOKEN = process.env.BRIDGE_TOKEN;
const MAX_PARALLEL = Number(process.env.BRIDGE_MAX_PARALLEL ?? 4);
const CALL_TIMEOUT_MS = 90_000;

if (!TOKEN) {
  console.error('BRIDGE_TOKEN fehlt. Starte die Brücke über scripts/start-bridge.sh.');
  process.exit(1);
}

// Leeres Arbeitsverzeichnis: keine Projekt-CLAUDE.md, keine Projekt-Einstellungen.
const WORKDIR = mkdtempSync(join(tmpdir(), 'claude-bridge-'));

// Ohne API-Key in der Umgebung meldet sich Claude Code mit dem Abo an.
const childEnv = { ...process.env };
delete childEnv.ANTHROPIC_API_KEY;
delete childEnv.ANTHROPIC_AUTH_TOKEN;
delete childEnv.BRIDGE_TOKEN;

// --- einfache Warteschlange, damit 20 gleichzeitige Anfragen nicht 20 Prozesse starten
let running = 0;
const queue = [];
function limited(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++;
      fn().then(resolve, reject).finally(() => {
        running--;
        queue.shift()?.();
      });
    };
    running < MAX_PARALLEL ? run() : queue.push(run);
  });
}

function runClaude({ model, system, prompt, schema, effort }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', system ?? '',
    '--tools', '',                  // reiner Text-Aufruf, keine Werkzeuge
    '--strict-mcp-config',          // keine MCP-Server laden
    '--setting-sources', 'project', // keine Nutzer-Einstellungen/Hooks (Projekt = leeres WORKDIR)
    '--disable-slash-commands',
    '--no-session-persistence',
  ];
  if (effort) args.push('--effort', effort);
  if (schema) args.push('--json-schema', JSON.stringify(schema));

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: WORKDIR, env: childEnv });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude -p hat nach ${CALL_TIMEOUT_MS / 1000}s nicht geantwortet`));
    }, CALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`Unerwartete Ausgabe von claude -p: ${(stderr || stdout).slice(0, 500)}`));
      }
    });
    child.stdin.end(prompt); // Prompt über stdin, nicht als Argument
  });
}

// Antwort von `claude -p` in die Form einer Messages-API-Antwort bringen,
// damit validate_classification und merge_reply unverändert funktionieren.
function toMessage(result, model, wantsJson) {
  const u = result.usage ?? {};
  const text = wantsJson && result.structured_output
    ? JSON.stringify(result.structured_output)
    : String(result.result ?? '');
  const stop = ['refusal', 'max_tokens'].includes(result.stop_reason) ? result.stop_reason : 'end_turn';
  return {
    id: `msg_bridge_${result.session_id ?? Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: stop === 'refusal' ? [] : [{ type: 'text', text }],
    stop_reason: stop,
    usage: {
      input_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output_tokens: u.output_tokens ?? 0,
    },
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const apiError = (type, message) => ({ type: 'error', error: { type, message } });

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, running, queued: queue.length });
  if (req.method !== 'POST' || req.url !== '/v1/messages') return send(res, 404, apiError('not_found_error', 'Nur POST /v1/messages'));
  if (req.headers['x-api-key'] !== TOKEN) return send(res, 401, apiError('authentication_error', 'Falscher x-api-key'));

  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, apiError('invalid_request_error', 'Body ist kein JSON'));
    }
    const prompt = body.messages?.filter((m) => m.role === 'user').map((m) =>
      typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    ).join('\n\n');
    if (!prompt) return send(res, 400, apiError('invalid_request_error', 'Keine User-Message'));

    const schema = body.output_config?.format?.schema;
    const started = Date.now();
    try {
      const result = await limited(() => runClaude({
        model: body.model, system: body.system, prompt, schema, effort: body.output_config?.effort,
      }));
      if (result.is_error) {
        console.error(new Date().toISOString(), 'Fehler', result.result ?? result.subtype);
        return send(res, 502, apiError('api_error', String(result.result ?? result.subtype)));
      }
      console.log(new Date().toISOString(), body.model, schema ? 'json' : 'text', `${Date.now() - started}ms`);
      send(res, 200, toMessage(result, body.model, Boolean(schema)));
    } catch (err) {
      console.error(new Date().toISOString(), 'Fehler', err.message);
      send(res, 502, apiError('api_error', err.message));
    }
  });
}).listen(PORT, HOST, () => {
  console.log(`Claude-Bridge läuft auf Port ${PORT} (max. ${MAX_PARALLEL} parallel), Arbeitsverzeichnis ${WORKDIR}`);
});

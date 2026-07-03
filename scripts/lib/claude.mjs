/**
 * Headless `claude` driver — spawn a new session (deterministic --session-id) or
 * resume one in place (--resume), both in stream-json print mode. Arg-building and
 * stream reduction are pure (unit-tested); the spawn is dependency-injected so the
 * orchestration is testable without a real claude process.
 *
 * Ported/adapted from github-agent-dispatcher/src/claude-cli.ts (runClaude + parseStreamEvent).
 */
import { spawn as nodeSpawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // 20 min — spawned sessions can do real work.

/**
 * @param {{mode: 'spawn'|'resume', sessionId: string, dangerouslySkipPermissions?: boolean}} o
 * @returns {string[]}
 */
export function buildArgs({ mode, sessionId, model, dangerouslySkipPermissions = true }) {
  const args = [];
  if (mode === 'resume') args.push('--resume', sessionId);
  else args.push('--session-id', sessionId);
  args.push('-p', '--output-format', 'stream-json', '--verbose');
  if (model) args.push('--model', model);
  if (dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
  return args;
}

/**
 * Aggregate stream-json events into a single result.
 * @param {object[]} events
 */
export function reduceStreamEvents(events) {
  let sessionId;
  let model;
  let resultText = '';
  let durationMs;
  const assistantTexts = [];
  const toolCalls = [];

  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'system' && e.subtype === 'init') {
      model = e.model ?? model;
      sessionId = e.session_id ?? sessionId;
    } else if (e.type === 'assistant') {
      const content = e.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === 'text' && typeof b.text === 'string') assistantTexts.push(b.text);
          if (b?.type === 'tool_use') toolCalls.push({ name: b.name });
        }
      }
    } else if (e.type === 'result' && e.subtype === 'success') {
      resultText = e.result ?? '';
      durationMs = e.duration_ms;
    }
  }

  if (!resultText) resultText = assistantTexts.join('\n');
  return { sessionId, model, resultText, durationMs, toolCalls };
}

function parseNdjson(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* ignore non-JSON heartbeat/log lines */
    }
  }
  return events;
}

/**
 * Run `claude` headless and resolve the reduced result. Never rejects — failures
 * come back as { success: false, ... } so the orchestrator can post them to Slack.
 *
 * @param {{
 *   mode: 'spawn'|'resume', sessionId: string, prompt: string, cwd: string,
 *   dangerouslySkipPermissions?: boolean, timeoutMs?: number, spawnFn?: Function
 * }} o
 */
export function runClaude({
  mode,
  sessionId,
  prompt,
  cwd,
  model,
  dangerouslySkipPermissions = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnFn = nodeSpawn,
}) {
  const args = buildArgs({ mode, sessionId, model, dangerouslySkipPermissions });

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn('claude', args, {
        cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ success: false, exitCode: 1, error: String(err?.message ?? err), sessionId, resultText: '' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      finish({ success: false, exitCode: 124, error: `timed out after ${timeoutMs}ms`, sessionId, resultText: '' });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch { /* stdin may be closed already */ }

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      finish({ success: false, exitCode: 1, error: String(err?.message ?? err), sessionId, resultText: '' });
    });

    child.on('close', (code) => {
      const reduced = reduceStreamEvents(parseNdjson(stdout));
      const exitCode = code ?? 1;
      finish({
        success: exitCode === 0,
        exitCode,
        error: exitCode === 0 ? undefined : (stderr || `exited ${exitCode}`),
        sessionId: reduced.sessionId || sessionId,
        model: reduced.model,
        resultText: reduced.resultText,
        durationMs: reduced.durationMs,
        toolCalls: reduced.toolCalls,
      });
    });
  });
}

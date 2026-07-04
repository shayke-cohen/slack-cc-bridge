#!/usr/bin/env node
/**
 * slack-cc-bridge — deterministic plumbing for the /slack-cc-bridge skill.
 *
 * The skill (a Claude session) owns Slack I/O via MCP; this CLI owns the things a
 * plain script does better than an LLM loop: gating self-only messages, creating
 * per-thread git worktrees, spawning/resuming headless `claude` sessions, tailing
 * transcripts for the reverse (session -> Slack) direction, and the thread<->session
 * state map. Every subcommand prints one JSON object to stdout.
 *
 * Subcommands:
 *   guard        --author U --channel C
 *   worktree-add --thread TS
 *   worktree-rm  --thread TS
 *   spawn        --thread TS --cwd DIR --prompt TEXT --author U --channel C [--session UUID]
 *   resume       --thread TS --prompt TEXT --author U --channel C
 *   tail         --thread TS
 *   state-get
 *   set-last-seen --ts TS
 *
 * Config/state paths are overridable via SCCB_CONFIG / SCCB_STATE (used by tests).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { checkGate } from './lib/guard.mjs';
import { classify } from './lib/classify.mjs';
import { loadState, saveState, upsertThread } from './lib/state.mjs';
import { tailAssistantText } from './lib/tail.mjs';
import { runClaude } from './lib/claude.mjs';
import { worktreeAdd, worktreeRemove } from './lib/worktree.mjs';
import { findTranscript } from './lib/paths.mjs';
import { linkTranscript, unlinkTranscript } from './lib/link.mjs';
import { ideActiveSession } from './lib/driver.mjs';
import { runDoctor } from './lib/doctor.mjs';
import { mdToSlack } from './lib/slackfmt.mjs';
import { notifyDesktop } from './lib/notify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.SCCB_CONFIG || path.join(HERE, '..', 'config.json');
const STATE_PATH = process.env.SCCB_STATE || path.join(HERE, '..', 'data', 'state.json');
const PROJECTS_ROOT = process.env.SCCB_PROJECTS_ROOT || undefined; // lib default = ~/.claude/projects
const SESSIONS_DIR = process.env.SCCB_SESSIONS_DIR || undefined; // lib default = ~/.claude/sessions

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return { cmd, flags };
}

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // Per-run overrides (skill args → env). Nothing is baked in; config.json is the default,
  // and any of these env vars wins for this invocation.
  if (process.env.SCCB_CHANNEL) cfg.channel = process.env.SCCB_CHANNEL;
  if (process.env.SCCB_AUTHOR) cfg.author = process.env.SCCB_AUTHOR;
  if (process.env.SCCB_BASE_REPO) cfg.baseRepo = process.env.SCCB_BASE_REPO;
  if (process.env.SCCB_LIST_WORKSPACE) cfg.listWorkspace = process.env.SCCB_LIST_WORKSPACE;
  return cfg;
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => resolve(s));
  });
}

/** Locate the transcript + its current EOF byte offset for a just-run session. */
function transcriptInfo(sessionId, cwd) {
  const transcriptPath = findTranscript(sessionId, { cwd, projectsRoot: PROJECTS_ROOT });
  let offset = 0;
  if (transcriptPath) {
    try { offset = fs.statSync(transcriptPath).size; } catch { offset = 0; }
  }
  return { transcriptPath, offset };
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));

  // `doctor` must run even before config.json exists (fresh install).
  if (cmd === 'doctor') {
    let cfg = null;
    try { cfg = loadConfig(); } catch { /* missing or invalid config */ }
    out(runDoctor(cfg));
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    out({ error: `cannot read ${CONFIG_PATH}: ${e.message}`, hint: 'copy config.example.json → config.json, then fill it in (see: bridge doctor)' });
    process.exit(2);
  }

  switch (cmd) {
    case 'guard': {
      const r = checkGate({ author: flags.author, channel: flags.channel, botId: flags.botId }, config);
      out(r);
      process.exit(r.allowed ? 0 : 3);
      break;
    }

    case 'classify': {
      // stdin = { channel: [...get_channel_history msgs...], threads: { ts: [...get_thread_replies...] } }
      let input;
      try { input = JSON.parse((await readStdin()) || '{}'); } catch { input = {}; }
      out(classify(input, loadState(STATE_PATH), config));
      break;
    }

    case 'worktree-add': {
      const wt = worktreeAdd({
        baseRepo: config.baseRepo,
        worktreeRoot: config.worktreeRoot,
        thread: flags.thread,
        baseRef: config.baseRef || 'HEAD',
      });
      out(wt);
      break;
    }

    case 'worktree-rm': {
      worktreeRemove({ baseRepo: config.baseRepo, worktreeRoot: config.worktreeRoot, thread: flags.thread });
      const state = loadState(STATE_PATH);
      const entry = state.threads[flags.thread];
      if (entry?.sessionId) unlinkTranscript({ sessionId: entry.sessionId, listWorkspace: config.listWorkspace, projectsRoot: PROJECTS_ROOT });
      delete state.threads[flags.thread];
      saveState(STATE_PATH, state);
      out({ ok: true });
      break;
    }

    case 'spawn': {
      const gate = checkGate({ author: flags.author, channel: flags.channel }, config);
      if (!gate.allowed) { out(gate); process.exit(3); }

      // Idempotent per thread: if the orchestrator re-processes the same @cc message, don't
      // mint a second session — return the one already bound to this thread. (--force overrides.)
      const already = loadState(STATE_PATH).threads[flags.thread];
      if (already?.sessionId && already.status === 'active' && !flags.force) {
        out({ skipped: true, reason: 'already-spawned', sessionId: already.sessionId, thread: flags.thread });
        break;
      }

      const sessionId = flags.session || crypto.randomUUID();
      const cwd = flags.cwd;
      const model = flags.model || config.defaultModel;
      const res = await runClaude({ mode: 'spawn', sessionId, prompt: String(flags.prompt ?? ''), cwd, model });

      const finalId = res.sessionId || sessionId;
      const { transcriptPath, offset } = transcriptInfo(finalId, cwd);

      // Make the worktree-isolated session appear in the list of the folder the user keeps open.
      const linkPath = linkTranscript({ transcriptPath, listWorkspace: config.listWorkspace, projectsRoot: PROJECTS_ROOT });

      const state = loadState(STATE_PATH);
      upsertThread(state, flags.thread, {
        sessionId: finalId, cwd, worktree: flags.worktree || cwd, model,
        channel: flags.channel, // which channel this thread lives in (for replies/polling)
        transcriptPath, linkPath, offset, status: 'active', driver: 'bridge',
        // start the reply cursor at the root so only replies AFTER the @cc message count
        lastReplyTs: flags.thread,
      });
      saveState(STATE_PATH, state);

      out({ ...res, sessionId: finalId, transcriptPath, slackText: mdToSlack(res.resultText) });
      process.exit(res.success ? 0 : 1);
      break;
    }

    case 'resume': {
      const gate = checkGate({ author: flags.author, channel: flags.channel }, config);
      if (!gate.allowed) { out(gate); process.exit(3); }

      const state = loadState(STATE_PATH);
      const entry = state.threads[flags.thread];
      if (!entry) { out({ error: 'unknown-thread', thread: flags.thread }); process.exit(4); }

      // Single-active-driver guard — unless the user opted into concurrent resume. The transcript
      // is line-append-safe JSONL, so this only avoids divergent context, not corruption.
      const ideWindowMs = (config.ideActiveWindowSeconds ?? 120) * 1000;
      if (!config.allowConcurrentResume && ideActiveSession(entry.sessionId, { sessionsDir: SESSIONS_DIR, maxAgeMs: ideWindowMs })) {
        out({ skipped: true, reason: 'ide-active', sessionId: entry.sessionId });
        process.exit(0);
      }

      const model = flags.model || entry.model || config.defaultModel;
      const res = await runClaude({ mode: 'resume', sessionId: entry.sessionId, prompt: String(flags.prompt ?? ''), cwd: entry.cwd, model });
      const { transcriptPath, offset } = transcriptInfo(entry.sessionId, entry.cwd);
      upsertThread(state, flags.thread, {
        transcriptPath: transcriptPath || entry.transcriptPath, offset,
        // advance the per-thread reply cursor so this reply is never re-processed
        ...(flags.replyTs ? { lastReplyTs: flags.replyTs } : {}),
      });
      saveState(STATE_PATH, state);

      out({ ...res, sessionId: entry.sessionId, transcriptPath: transcriptPath || entry.transcriptPath, slackText: mdToSlack(res.resultText) });
      process.exit(res.success ? 0 : 1);
      break;
    }

    case 'tail': {
      const state = loadState(STATE_PATH);
      const entry = state.threads[flags.thread];
      if (!entry) { out({ texts: [], newOffset: 0, slackTexts: [] }); break; }

      const transcriptPath = entry.transcriptPath || findTranscript(entry.sessionId, { cwd: entry.cwd, projectsRoot: PROJECTS_ROOT });
      const { texts, newOffset } = tailAssistantText(transcriptPath, entry.offset || 0);
      upsertThread(state, flags.thread, { transcriptPath, offset: newOffset });
      saveState(STATE_PATH, state);
      out({ texts, newOffset, slackTexts: texts.map(mdToSlack) });
      break;
    }

    case 'fmt': {
      // Convert Markdown (stdin) → Slack mrkdwn for posting. Emits {slackText}.
      out({ slackText: mdToSlack(await readStdin()) });
      break;
    }

    case 'notify': {
      // Local desktop alert (the self-DM can't notify you). macOS only; no-op elsewhere.
      const dispatched = notifyDesktop({
        title: flags.title || 'slack-cc-bridge',
        message: String(flags.message ?? ''),
        sound: flags.sound !== 'false',
      });
      out({ ok: true, dispatched });
      break;
    }

    case 'state-get': {
      out(loadState(STATE_PATH));
      break;
    }

    case 'config-get': {
      // Resolved config (config.json + any SCCB_* env overrides). The skill reads
      // channel/author/etc. from here instead of hardcoding them.
      out(config);
      break;
    }

    case 'set-last-seen': {
      const state = loadState(STATE_PATH);
      const ch = flags.channel || config.channel || (config.channels && config.channels[0]);
      const ts = String(flags.ts ?? '');
      state.lastSeen = state.lastSeen || {};
      if (ch) state.lastSeen[ch] = ts; else state.lastSeenTs = ts;
      saveState(STATE_PATH, state);
      out({ ok: true, channel: ch, ts });
      break;
    }

    case 'close': {
      const state = loadState(STATE_PATH);
      const entry = state.threads[flags.thread];
      if (entry) entry.status = 'closed';
      saveState(STATE_PATH, state);
      out({ ok: true, thread: flags.thread, closed: !!entry });
      break;
    }

    case 'prune': {
      // Close threads idle past the TTL; hard-remove ones idle past 2× TTL so state stays bounded.
      const maxAgeHours = Number(flags.maxAgeHours ?? config.threadTtlHours ?? 24);
      const nowSec = Date.now() / 1000;
      const closeCut = nowSec - maxAgeHours * 3600;
      const removeCut = nowSec - 2 * maxAgeHours * 3600;
      const state = loadState(STATE_PATH);
      let closed = 0;
      let removed = 0;
      for (const [ts, entry] of Object.entries(state.threads)) {
        const last = parseFloat(entry.lastReplyTs || ts);
        if (last < removeCut) {
          if (entry.sessionId) unlinkTranscript({ sessionId: entry.sessionId, listWorkspace: config.listWorkspace, projectsRoot: PROJECTS_ROOT });
          delete state.threads[ts];
          removed++;
        } else if (last < closeCut && entry.status !== 'closed') { entry.status = 'closed'; closed++; }
      }
      saveState(STATE_PATH, state);
      out({ ok: true, closed, removed });
      break;
    }

    default:
      out({ error: 'unknown-command', cmd });
      process.exit(2);
  }
}

main().catch((err) => {
  out({ error: String(err?.message ?? err) });
  process.exit(1);
});

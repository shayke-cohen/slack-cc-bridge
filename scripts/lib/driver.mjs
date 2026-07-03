/**
 * Single-active-driver guard. Never `--resume` a session the human is live-driving in
 * VS Code (concurrent writers to one transcript race). Best-effort heuristic: Claude Code
 * writes ~/.claude/sessions/<pid>.json = {sessionId, kind:'interactive', ...}; if a fresh
 * interactive file names this session, the IDE is (probably) driving it, so we mirror-only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * @param {string} sessionId
 * @param {{sessionsDir?: string, maxAgeMs?: number}} [o]
 * @returns {boolean}
 */
export function ideActiveSession(sessionId, { sessionsDir = DEFAULT_SESSIONS_DIR, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  let files;
  try {
    files = fs.readdirSync(sessionsDir);
  } catch {
    return false;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(sessionsDir, f);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) continue;
      const meta = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (meta.sessionId === sessionId && meta.kind === 'interactive') return true;
    } catch {
      /* skip unreadable/partial files */
    }
  }
  return false;
}

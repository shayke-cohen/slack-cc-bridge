/**
 * Thread <-> session state store, persisted as one atomic JSON file.
 *
 * Shape: { threads: { [threadTs]: {sessionId, worktree, transcriptPath, offset, status, driver} },
 *          lastSeenTs: string }
 *
 * Atomic write (tmp + rename) ported from ck-internal-bi/hooks/bi-utils.js saveJsonFile,
 * so a crash mid-write can never leave a half-written state file.
 */
import fs from 'node:fs';
import path from 'node:path';

// `lastSeen` is the per-channel poll cursor { [channelId]: ts }. `lastSeenTs` is kept for
// back-compat with single-channel state.
const DEFAULT_STATE = () => ({ threads: {}, lastSeen: {}, lastSeenTs: '0' });

/** @param {string} filePath */
export function loadState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      threads: parsed.threads ?? {},
      lastSeen: parsed.lastSeen ?? {},
      lastSeenTs: parsed.lastSeenTs ?? '0',
    };
  } catch {
    return DEFAULT_STATE();
  }
}

/** @param {string} filePath @param {object} state */
export function saveState(filePath, state) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Merge `patch` into the entry for `threadTs` (creating it if absent) and return it.
 * @param {object} state @param {string} threadTs @param {object} patch
 */
export function upsertThread(state, threadTs, patch) {
  const existing = state.threads[threadTs] ?? {};
  const merged = { ...existing, ...patch };
  state.threads[threadTs] = merged;
  return merged;
}

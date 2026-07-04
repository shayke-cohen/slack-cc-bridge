/**
 * Locate a session's transcript. Claude Code writes transcripts to
 * ~/.claude/projects/<projectHash>/<sessionId>.jsonl where projectHash is the cwd with
 * every non-alphanumeric char replaced by '-' (e.g. /private/tmp -> -private-tmp).
 *
 * We first try the computed path, then fall back to scanning every project dir for
 * <sessionId>.jsonl — the scan is bulletproof regardless of the exact hashing rule.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

/** @param {string} cwd */
export function projectHash(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Copy-pasteable CLI to take a session over yourself (from the worktree it runs in). */
export function resumeCommand(cwd, sessionId) {
  return `cd "${cwd}" && claude --resume ${sessionId}`;
}

/**
 * @param {string} sessionId
 * @param {{cwd?: string, projectsRoot?: string}} [o]
 * @returns {string|null} absolute path to the transcript, or null if not found
 */
export function findTranscript(sessionId, { cwd, projectsRoot = DEFAULT_PROJECTS_ROOT } = {}) {
  const fname = `${sessionId}.jsonl`;

  if (cwd) {
    const candidate = path.join(projectsRoot, projectHash(cwd), fname);
    if (fs.existsSync(candidate)) return candidate;
  }

  let dirs;
  try {
    dirs = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const candidate = path.join(projectsRoot, d.name, fname);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Make a worktree-isolated session appear in a chosen workspace's VS Code list.
 *
 * The extension lists sessions by scanning ~/.claude/projects/<encode(openFolder)>/*.jsonl.
 * A per-thread worktree is a different folder → different project dir → invisible there.
 * So we HARDLINK the worktree session's transcript into the list workspace's project dir:
 * the extension then lists it (same inode → reflects new turns), and because `claude --resume`
 * respects the transcript's recorded cwd, continuing it — even from the list — stays in the
 * isolated worktree. Isolation AND visibility, both.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectHash } from './paths.mjs';

const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

/** Where the link for `transcriptPath` would live inside `listWorkspace`'s project dir. */
export function workspaceLinkPath(listWorkspace, transcriptPath, projectsRoot = DEFAULT_PROJECTS_ROOT) {
  return path.join(projectsRoot, projectHash(listWorkspace), path.basename(transcriptPath));
}

/**
 * Hardlink `transcriptPath` into `listWorkspace`'s project dir. Falls back to a symlink if
 * hardlinking fails (e.g. cross-filesystem). Returns the link path, or null if not applicable.
 * @param {{transcriptPath?: string, listWorkspace?: string, projectsRoot?: string}} o
 */
export function linkTranscript({ transcriptPath, listWorkspace, projectsRoot = DEFAULT_PROJECTS_ROOT }) {
  if (!transcriptPath || !listWorkspace) return null;
  const dest = workspaceLinkPath(listWorkspace, transcriptPath, projectsRoot);
  if (path.resolve(dest) === path.resolve(transcriptPath)) return null; // already in that workspace

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.unlinkSync(dest); } catch { /* nothing to replace */ }
  try {
    fs.linkSync(transcriptPath, dest); // hardlink
  } catch {
    try { fs.symlinkSync(transcriptPath, dest); } catch { return null; }
  }
  return dest;
}

/**
 * Remove a session's link from `listWorkspace`'s project dir (called on close/prune/worktree-rm).
 * @param {{sessionId?: string, listWorkspace?: string, projectsRoot?: string}} o
 */
export function unlinkTranscript({ sessionId, listWorkspace, projectsRoot = DEFAULT_PROJECTS_ROOT }) {
  if (!sessionId || !listWorkspace) return false;
  const dest = path.join(projectsRoot, projectHash(listWorkspace), `${sessionId}.jsonl`);
  try {
    fs.unlinkSync(dest);
    return true;
  } catch {
    return false;
  }
}

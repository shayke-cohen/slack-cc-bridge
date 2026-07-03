/**
 * Per-thread git worktree isolation. Each Slack thread gets its own worktree on its
 * own branch off the base repo, so parallel Slack-driven sessions never collide and
 * each shows up as its own VS Code project. Matches the established
 * "isolated worktree off origin/master" pattern.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Slack thread ts -> a git-safe leaf ('1783055616.871749' -> '1783055616-871749'). */
function safeLeaf(thread) {
  return String(thread).replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** Branch name for a thread. */
export function branchForThread(thread) {
  return `sccb/${safeLeaf(thread)}`;
}

function git(baseRepo, args) {
  return execFileSync('git', args, { cwd: baseRepo, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

/**
 * Create (or reuse) the worktree for a thread.
 * @param {{baseRepo: string, worktreeRoot: string, thread: string, baseRef?: string}} o
 * @returns {{path: string, branch: string}}
 */
export function worktreeAdd({ baseRepo, worktreeRoot, thread, baseRef = 'HEAD' }) {
  const branch = branchForThread(thread);
  const wtPath = path.join(worktreeRoot, safeLeaf(thread));

  if (fs.existsSync(wtPath)) return { path: wtPath, branch };

  fs.mkdirSync(worktreeRoot, { recursive: true });
  git(baseRepo, ['worktree', 'add', '-b', branch, wtPath, baseRef]);
  return { path: wtPath, branch };
}

/**
 * Detach a thread's worktree from the base repo. The branch is intentionally kept so
 * the work survives for a manual PR/merge.
 * @param {{baseRepo: string, worktreeRoot: string, thread: string}} o
 */
export function worktreeRemove({ baseRepo, worktreeRoot, thread }) {
  const wtPath = path.join(worktreeRoot, safeLeaf(thread));
  try {
    git(baseRepo, ['worktree', 'remove', '--force', wtPath]);
  } catch {
    // Fall back to pruning stale metadata if the dir was already gone.
    try { git(baseRepo, ['worktree', 'prune']); } catch { /* best effort */ }
  }
}

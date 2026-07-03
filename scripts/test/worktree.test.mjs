import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { worktreeAdd, worktreeRemove, branchForThread } from '../lib/worktree.mjs';

// Build a throwaway git repo with one commit so HEAD exists.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-wt-'));
  const baseRepo = path.join(root, 'repo');
  fs.mkdirSync(baseRepo);
  const git = (...a) => execFileSync('git', a, { cwd: baseRepo, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-q', '-m', 'root');
  return { baseRepo, worktreeRoot: path.join(root, 'worktrees') };
}

const THREAD = '1783055616.871749';

test('worktreeAdd creates an isolated worktree on a per-thread branch', () => {
  const { baseRepo, worktreeRoot } = makeRepo();
  const wt = worktreeAdd({ baseRepo, worktreeRoot, thread: THREAD });

  assert.ok(fs.existsSync(wt.path), 'worktree dir should exist');
  assert.equal(wt.branch, branchForThread(THREAD));

  const head = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt.path })
    .toString()
    .trim();
  assert.equal(head, wt.branch);
});

test('branchForThread sanitizes the dotted Slack timestamp', () => {
  assert.equal(branchForThread('1783055616.871749'), 'sccb/1783055616-871749');
});

test('worktreeAdd is idempotent for an existing thread (no throw, same path)', () => {
  const { baseRepo, worktreeRoot } = makeRepo();
  const a = worktreeAdd({ baseRepo, worktreeRoot, thread: THREAD });
  const b = worktreeAdd({ baseRepo, worktreeRoot, thread: THREAD });
  assert.equal(a.path, b.path);
});

test('worktreeRemove detaches the worktree from the base repo', () => {
  const { baseRepo, worktreeRoot } = makeRepo();
  const wt = worktreeAdd({ baseRepo, worktreeRoot, thread: THREAD });
  worktreeRemove({ baseRepo, thread: THREAD, worktreeRoot });

  const list = execFileSync('git', ['worktree', 'list'], { cwd: baseRepo }).toString();
  assert.ok(!list.includes(wt.path), 'removed worktree should not be listed');
});

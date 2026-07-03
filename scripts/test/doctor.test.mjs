import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDoctor } from '../lib/doctor.mjs';

function fullConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-doc-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true }); // looks like a git repo
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  return {
    channel: 'D0123', author: 'U0123',
    baseRepo: repo, listWorkspace: ws, worktreeRoot: path.join(root, 'wt'),
  };
}

test('a missing config fails with a copy-the-example hint', () => {
  const r = runDoctor(null);
  assert.equal(r.ok, false);
  assert.equal(r.checks[0].name, 'config.json present');
  assert.equal(r.checks[0].ok, false);
});

test('placeholder channel/author are flagged', () => {
  const cfg = { ...fullConfig(), channel: '', author: '' };
  const r = runDoctor(cfg);
  assert.equal(r.ok, false);
  const failed = r.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.includes('channel set'));
  assert.ok(failed.includes('author set'));
});

test('baseRepo that is not a git repo is flagged', () => {
  const cfg = fullConfig();
  cfg.baseRepo = os.tmpdir(); // exists but no .git → not a repo
  const r = runDoctor(cfg);
  assert.ok(r.checks.some((c) => c.name === 'baseRepo is a git repo' && !c.ok));
});

test('a fully valid config passes', () => {
  const r = runDoctor(fullConfig());
  assert.equal(r.ok, true, JSON.stringify(r.checks));
});

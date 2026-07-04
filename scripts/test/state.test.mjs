import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, upsertThread } from '../lib/state.mjs';

function tmpStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-state-'));
  return path.join(dir, 'nested', 'state.json');
}

test('loadState returns a default shape when the file is missing', () => {
  const p = tmpStatePath();
  const s = loadState(p);
  assert.deepEqual(s, { threads: {}, lastSeen: {}, lastSeenTs: '0' });
});

test('saveState then loadState round-trips a thread entry', () => {
  const p = tmpStatePath();
  const s = loadState(p);
  upsertThread(s, '1783055616.871749', { sessionId: 'abc', worktree: '/wt/a', offset: 0 });
  s.lastSeenTs = '1783055616.871749';
  saveState(p, s);

  const reloaded = loadState(p);
  assert.equal(reloaded.lastSeenTs, '1783055616.871749');
  assert.equal(reloaded.threads['1783055616.871749'].sessionId, 'abc');
  assert.equal(reloaded.threads['1783055616.871749'].worktree, '/wt/a');
});

test('upsertThread merges patches without dropping prior fields', () => {
  const s = { threads: {}, lastSeen: {}, lastSeenTs: '0' };
  upsertThread(s, 't1', { sessionId: 'abc', offset: 0 });
  const entry = upsertThread(s, 't1', { offset: 42, status: 'active' });
  assert.equal(entry.sessionId, 'abc');
  assert.equal(entry.offset, 42);
  assert.equal(entry.status, 'active');
});

test('saveState writes atomically and leaves no .tmp files behind', () => {
  const p = tmpStatePath();
  saveState(p, { threads: {}, lastSeen: {}, lastSeenTs: '0' });
  const leftover = fs.readdirSync(path.dirname(p)).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftover, []);
});

test('loadState returns the default shape on corrupt JSON', () => {
  const p = tmpStatePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{ not valid json');
  assert.deepEqual(loadState(p), { threads: {}, lastSeen: {}, lastSeenTs: '0' });
});

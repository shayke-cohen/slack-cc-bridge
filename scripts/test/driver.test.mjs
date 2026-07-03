import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ideActiveSession } from '../lib/driver.mjs';

function sessionsDirWith(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-sess-'));
  for (const [name, obj] of Object.entries(entries)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
  }
  return dir;
}

test('detects a fresh interactive session for the given id', () => {
  const dir = sessionsDirWith({ '111.json': { sessionId: 'S1', kind: 'interactive' } });
  assert.equal(ideActiveSession('S1', { sessionsDir: dir }), true);
});

test('ignores a session file for a different id', () => {
  const dir = sessionsDirWith({ '111.json': { sessionId: 'S2', kind: 'interactive' } });
  assert.equal(ideActiveSession('S3', { sessionsDir: dir }), false);
});

test('ignores a stale interactive session (older than the freshness window)', () => {
  const dir = sessionsDirWith({ '111.json': { sessionId: 'S1', kind: 'interactive' } });
  const stale = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(path.join(dir, '111.json'), stale, stale);
  assert.equal(ideActiveSession('S1', { sessionsDir: dir, maxAgeMs: 120000 }), false);
});

test('returns false when the sessions dir does not exist', () => {
  assert.equal(ideActiveSession('S1', { sessionsDir: '/no/such/dir' }), false);
});

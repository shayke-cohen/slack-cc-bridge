import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectHash, findTranscript, resumeCommand } from '../lib/paths.mjs';

test('resumeCommand builds a copy-pasteable cd + claude --resume line (quoted cwd)', () => {
  assert.equal(
    resumeCommand('/Users/shayco/wt space', 'abc-123'),
    'cd "/Users/shayco/wt space" && claude --resume abc-123',
  );
});

test('projectHash mirrors how Claude Code names project dirs', () => {
  assert.equal(projectHash('/private/tmp'), '-private-tmp');
  assert.equal(projectHash('/Users/shayco/New Mobile Arc'), '-Users-shayco-New-Mobile-Arc');
});

test('findTranscript locates <sessionId>.jsonl by scanning the projects root', () => {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-proj-'));
  // Put the transcript under a project dir whose name does NOT match the cwd hash,
  // proving the scan fallback works regardless of the hashing formula.
  const projDir = path.join(projectsRoot, '-some-other-hash');
  fs.mkdirSync(projDir, { recursive: true });
  const sessionId = 'abc-123';
  const file = path.join(projDir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, '{}\n');

  const found = findTranscript(sessionId, { cwd: '/whatever', projectsRoot });
  assert.equal(found, file);
});

test('findTranscript returns null when no transcript exists', () => {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-proj-'));
  assert.equal(findTranscript('missing', { cwd: '/x', projectsRoot }), null);
});

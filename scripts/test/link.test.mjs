import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkTranscript, unlinkTranscript, workspaceLinkPath } from '../lib/link.mjs';

function setup() {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-link-'));
  const wtProj = path.join(projectsRoot, '-wt-hash');
  fs.mkdirSync(wtProj, { recursive: true });
  const transcriptPath = path.join(wtProj, 'sid-1.jsonl');
  fs.writeFileSync(transcriptPath, 'line one\n');
  return { projectsRoot, transcriptPath };
}

const WS = '/Users/foo/My Repo';

test('linkTranscript hardlinks the transcript into the listWorkspace project dir', () => {
  const { projectsRoot, transcriptPath } = setup();
  const dest = linkTranscript({ transcriptPath, listWorkspace: WS, projectsRoot });
  assert.equal(dest, path.join(projectsRoot, '-Users-foo-My-Repo', 'sid-1.jsonl'));
  assert.ok(fs.existsSync(dest));
  // same inode → true hardlink, and new turns are reflected
  assert.equal(fs.statSync(dest).ino, fs.statSync(transcriptPath).ino);
  fs.appendFileSync(transcriptPath, 'line two\n');
  assert.match(fs.readFileSync(dest, 'utf8'), /line two/);
});

test('unlinkTranscript removes the link by session id', () => {
  const { projectsRoot, transcriptPath } = setup();
  linkTranscript({ transcriptPath, listWorkspace: WS, projectsRoot });
  assert.equal(unlinkTranscript({ sessionId: 'sid-1', listWorkspace: WS, projectsRoot }), true);
  assert.ok(!fs.existsSync(path.join(projectsRoot, '-Users-foo-My-Repo', 'sid-1.jsonl')));
});

test('linkTranscript is a no-op when the session already lives in the list workspace', () => {
  const { projectsRoot } = setup();
  const selfDir = path.join(projectsRoot, workspaceLinkPath(WS, 'x', '.').split(path.sep)[0] || '');
  const wsDir = path.join(projectsRoot, '-Users-foo-My-Repo');
  fs.mkdirSync(wsDir, { recursive: true });
  const selfSrc = path.join(wsDir, 'sid-2.jsonl');
  fs.writeFileSync(selfSrc, '{}\n');
  assert.equal(linkTranscript({ transcriptPath: selfSrc, listWorkspace: WS, projectsRoot }), null);
});

test('linkTranscript returns null when inputs are missing', () => {
  const { projectsRoot, transcriptPath } = setup();
  assert.equal(linkTranscript({ transcriptPath: null, listWorkspace: WS, projectsRoot }), null);
  assert.equal(linkTranscript({ transcriptPath, listWorkspace: null, projectsRoot }), null);
});

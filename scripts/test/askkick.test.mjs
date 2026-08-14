import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kickWaitingAsks, resolveKickDir, DEFAULT_ASK_KICK_DIR } from '../lib/askkick.mjs';

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-kick-'));

test('resolveKickDir defaults to the skill\'s state dir', () => {
  assert.equal(resolveKickDir(undefined), DEFAULT_ASK_KICK_DIR);
  assert.match(DEFAULT_ASK_KICK_DIR, /agent-ask-user-in-slack\/kick$/);
});

test('resolveKickDir expands a leading tilde', () => {
  assert.equal(resolveKickDir('~/somewhere'), path.join(os.homedir(), '/somewhere'));
});

test('resolveKickDir passes an absolute path through', () => {
  assert.equal(resolveKickDir('/tmp/kicks'), '/tmp/kicks');
});

test('touching the ALL sentinel wakes every waiting ask', () => {
  const dir = tmpdir();
  const { kicked } = kickWaitingAsks({ kickDir: dir });
  assert.equal(kicked, path.join(dir, 'ALL'));
  assert.ok(fs.existsSync(kicked));
});

test('a missing kick dir is a silent no-op — the skill need not be installed', () => {
  const res = kickWaitingAsks({ kickDir: path.join(tmpdir(), 'not-there') });
  assert.equal(res.kicked, null);
  assert.match(res.reason, /not installed/);
});

test('a write failure is reported, never thrown', () => {
  const fsImpl = {
    existsSync: () => true,
    writeFileSync: () => { throw new Error('read-only file system'); },
  };
  const res = kickWaitingAsks({ kickDir: '/anywhere', fsImpl });
  assert.equal(res.kicked, null);
  assert.match(res.reason, /read-only file system/);
});

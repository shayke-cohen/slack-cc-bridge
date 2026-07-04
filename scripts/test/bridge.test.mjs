import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const BRIDGE = fileURLToPath(new URL('../bridge.mjs', import.meta.url));

// Isolated env: temp base git repo + temp config + temp state, so the CLI touches nothing real.
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-cli-'));
  const baseRepo = path.join(root, 'repo');
  fs.mkdirSync(baseRepo);
  const git = (...a) => execFileSync('git', a, { cwd: baseRepo, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@e.com');
  git('config', 'user.name', 'T');
  git('commit', '--allow-empty', '-q', '-m', 'root');

  const config = {
    channel: 'DC793D3D3',
    author: 'UC74Z40NN',
    trigger: '@cc',
    defaultModel: 'claude-opus-4-8',
    baseRepo,
    baseRef: 'HEAD',
    listWorkspace: baseRepo,
    worktreeRoot: path.join(root, 'worktrees'),
    pollSeconds: 45,
  };
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  const statePath = path.join(root, 'state.json');
  return { root, baseRepo, configPath, statePath, config };
}

function run(env, args) {
  try {
    const out = execFileSync('node', [BRIDGE, ...args], {
      env: { ...process.env, SCCB_CONFIG: env.configPath, SCCB_STATE: env.statePath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, json: JSON.parse(out.toString()) };
  } catch (e) {
    return { code: e.status ?? 1, json: e.stdout ? JSON.parse(e.stdout.toString()) : null };
  }
}

test('guard allows a genuine self message (exit 0)', () => {
  const env = sandbox();
  const r = run(env, ['guard', '--author', 'UC74Z40NN', '--channel', 'DC793D3D3']);
  assert.equal(r.code, 0);
  assert.equal(r.json.allowed, true);
});

test('guard rejects a forged author (non-zero exit, allowed:false)', () => {
  const env = sandbox();
  const r = run(env, ['guard', '--author', 'U000EVIL', '--channel', 'DC793D3D3']);
  assert.notEqual(r.code, 0);
  assert.equal(r.json.allowed, false);
});

test('spawn is idempotent — an already-spawned thread returns its session, no duplicate', () => {
  const env = sandbox();
  fs.writeFileSync(
    env.statePath,
    JSON.stringify({ threads: { t1: { sessionId: 'existing-sid', status: 'active' } }, lastSeenTs: '0' }),
  );
  const r = run(env, [
    'spawn', '--thread', 't1', '--cwd', env.baseRepo,
    '--prompt', 'do it again', '--author', 'UC74Z40NN', '--channel', 'DC793D3D3',
  ]);
  assert.equal(r.code, 0);
  assert.equal(r.json.skipped, true);
  assert.equal(r.json.sessionId, 'existing-sid');
});

test('resume mirrors-only (skips, no claude) when the session is open in VS Code and the guard is on', () => {
  const env = sandbox();
  fs.writeFileSync(
    env.statePath,
    JSON.stringify({ threads: { t1: { sessionId: 'S-IDE', cwd: env.baseRepo, status: 'active' } }, lastSeenTs: '0' }),
  );
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-ss-'));
  fs.writeFileSync(path.join(sessionsDir, '999.json'), JSON.stringify({ sessionId: 'S-IDE', kind: 'interactive' }));

  const out = execFileSync(
    'node',
    [BRIDGE, 'resume', '--thread', 't1', '--prompt', 'x', '--author', 'UC74Z40NN', '--channel', 'DC793D3D3'],
    { env: { ...process.env, SCCB_CONFIG: env.configPath, SCCB_STATE: env.statePath, SCCB_SESSIONS_DIR: sessionsDir } },
  );
  const j = JSON.parse(out.toString());
  assert.equal(j.skipped, true);
  assert.equal(j.reason, 'ide-active');
});

test('spawn is refused before running claude when the gate fails', () => {
  const env = sandbox();
  const r = run(env, [
    'spawn', '--thread', '1.1', '--cwd', env.baseRepo,
    '--prompt', 'do something', '--author', 'U000EVIL', '--channel', 'DC793D3D3',
  ]);
  assert.notEqual(r.code, 0);
  assert.equal(r.json.allowed, false);
  assert.match(r.json.reason, /author/i);
});

test('worktree-add then worktree-rm manage an isolated worktree', () => {
  const env = sandbox();
  const add = run(env, ['worktree-add', '--thread', '1783055616.871749']);
  assert.equal(add.code, 0);
  assert.ok(fs.existsSync(add.json.path));
  assert.equal(add.json.branch, 'sccb/1783055616-871749');

  const rm = run(env, ['worktree-rm', '--thread', '1783055616.871749']);
  assert.equal(rm.code, 0);
  assert.equal(rm.json.ok, true);
});

test('tail returns new assistant end_turn text and advances the stored offset', () => {
  const env = sandbox();
  // Seed a transcript + a state entry pointing at it with offset 0.
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-tx-'));
  const transcriptPath = path.join(tdir, 'sess.jsonl');
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'all done' }], stop_reason: 'end_turn' },
    }) + '\n',
  );
  fs.writeFileSync(
    env.statePath,
    JSON.stringify({
      threads: { 't9': { sessionId: 'sess', cwd: '/x', transcriptPath, offset: 0, status: 'active' } },
      lastSeenTs: '0',
    }),
  );

  const r = run(env, ['tail', '--thread', 't9']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.texts, ['all done']);
  assert.deepEqual(r.json.slackTexts, ['all done']); // slack-formatted variant for posting

  const state = JSON.parse(fs.readFileSync(env.statePath, 'utf8'));
  assert.equal(state.threads.t9.offset, r.json.newOffset);
  assert.ok(state.threads.t9.offset > 0);
});

test('classify reads a Slack poll from stdin and returns deduped, gated actions', () => {
  const env = sandbox();
  fs.writeFileSync(
    env.statePath,
    JSON.stringify({
      threads: { '200.000000': { sessionId: 's1', lastReplyTs: '200.000000' } },
      lastSeenTs: '199.000000',
    }),
  );
  const input = JSON.stringify({
    channel: [
      { user: 'UC74Z40NN', ts: '201.000000', text: '@cc build a thing' },
      { user: 'UC74Z40NN', ts: '202.000000', text: 'just a note to self' },
    ],
    threads: {
      '200.000000': [
        { user: 'UC74Z40NN', ts: '200.000000', text: '@cc root' },
        { user: 'UC74Z40NN', ts: '203.000000', text: 'and add tests' },
      ],
    },
  });
  const out = execFileSync('node', [BRIDGE, 'classify'], {
    env: { ...process.env, SCCB_CONFIG: env.configPath, SCCB_STATE: env.statePath },
    input,
  });
  const j = JSON.parse(out.toString());
  assert.deepEqual(j.newTasks, [{ channel: 'DC793D3D3', thread: '201.000000', text: 'build a thing', model: 'claude-opus-4-8' }]);
  assert.deepEqual(j.threadTurns, [{ channel: 'DC793D3D3', thread: '200.000000', ts: '203.000000', text: 'and add tests' }]);
  assert.equal(j.maxTs, '202.000000');
});

test('doctor passes on a fully-configured sandbox', () => {
  const env = sandbox();
  const r = run(env, ['doctor']);
  assert.equal(r.json.ok, true, JSON.stringify(r.json.checks));
});

test('doctor reports a missing config.json (no stack trace)', () => {
  const env = sandbox();
  const out = execFileSync('node', [BRIDGE, 'doctor'], {
    env: { ...process.env, SCCB_CONFIG: '/no/such/config.json', SCCB_STATE: env.statePath },
  });
  const j = JSON.parse(out.toString());
  assert.equal(j.ok, false);
  assert.equal(j.checks[0].name, 'config.json present');
});

test('config-get returns the configured channel/author', () => {
  const env = sandbox();
  const r = run(env, ['config-get']);
  assert.equal(r.code, 0);
  assert.equal(r.json.channel, 'DC793D3D3');
  assert.equal(r.json.author, 'UC74Z40NN');
});

test('SCCB_CHANNEL / SCCB_AUTHOR env vars override config for a run', () => {
  const env = sandbox();
  const out = execFileSync('node', [BRIDGE, 'config-get'], {
    env: { ...process.env, SCCB_CONFIG: env.configPath, SCCB_STATE: env.statePath, SCCB_CHANNEL: 'C_OVERRIDE', SCCB_AUTHOR: 'U_OVERRIDE' },
  });
  const j = JSON.parse(out.toString());
  assert.equal(j.channel, 'C_OVERRIDE');
  assert.equal(j.author, 'U_OVERRIDE');
});

test('the gate honors an overridden author (env)', () => {
  const env = sandbox();
  // With the override, the ORIGINAL author is no longer allowed; the new one is.
  const denied = (() => {
    try {
      execFileSync('node', [BRIDGE, 'guard', '--author', 'UC74Z40NN', '--channel', 'DC793D3D3'], {
        env: { ...process.env, SCCB_CONFIG: env.configPath, SCCB_STATE: env.statePath, SCCB_AUTHOR: 'U_OVERRIDE' },
      });
      return false;
    } catch (e) { return e.status === 3; }
  })();
  assert.equal(denied, true);
});

test('fmt converts stdin Markdown to Slack mrkdwn', () => {
  const env = sandbox();
  const out = execFileSync('node', [BRIDGE, 'fmt'], {
    env: { ...process.env, SCCB_CONFIG: env.configPath, SCCB_STATE: env.statePath },
    input: '## Hi\n\n**bold** and [x](https://y.io)\n- one',
  });
  const j = JSON.parse(out.toString());
  assert.equal(j.slackText, '*Hi*\n\n*bold* and <https://y.io|x>\n• one');
});

test('close marks a thread closed so the loop stops following it', () => {
  const env = sandbox();
  fs.writeFileSync(env.statePath, JSON.stringify({ threads: { t1: { sessionId: 's1', status: 'active' } }, lastSeenTs: '0' }));
  const r = run(env, ['close', '--thread', 't1']);
  assert.equal(r.code, 0);
  const state = JSON.parse(fs.readFileSync(env.statePath, 'utf8'));
  assert.equal(state.threads.t1.status, 'closed');
});

test('prune removes very-stale threads and keeps fresh ones', () => {
  const env = sandbox();
  const freshTs = `${Math.floor(Date.now() / 1000)}.000000`;
  fs.writeFileSync(
    env.statePath,
    JSON.stringify({
      threads: {
        '1000.000000': { sessionId: 'old', lastReplyTs: '1000.000000' }, // 1970 → ancient
        [freshTs]: { sessionId: 'new', lastReplyTs: freshTs },
      },
      lastSeenTs: '0',
    }),
  );
  const r = run(env, ['prune', '--maxAgeHours', '24']);
  assert.equal(r.code, 0);
  assert.ok(r.json.removed >= 1);
  const state = JSON.parse(fs.readFileSync(env.statePath, 'utf8'));
  assert.equal(state.threads['1000.000000'], undefined); // ancient removed
  assert.ok(state.threads[freshTs]); // fresh kept
});

test('set-last-seen persists a per-channel cursor and state-get reads it back', () => {
  const env = sandbox();
  const set = run(env, ['set-last-seen', '--channel', 'C_X', '--ts', '1783055616.871749']);
  assert.equal(set.code, 0);
  const get = run(env, ['state-get']);
  assert.equal(get.json.lastSeen.C_X, '1783055616.871749');
});

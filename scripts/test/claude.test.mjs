import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { buildArgs, reduceStreamEvents, runClaude } from '../lib/claude.mjs';

test('buildArgs for a new session uses --session-id + stream-json + bypass', () => {
  const args = buildArgs({ mode: 'spawn', sessionId: 'uuid-1' });
  assert.deepEqual(args, [
    '--session-id', 'uuid-1',
    '-p', '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions',
  ]);
});

test('buildArgs for a resume uses --resume, not --session-id', () => {
  const args = buildArgs({ mode: 'resume', sessionId: 'uuid-1' });
  assert.ok(args.includes('--resume'));
  assert.ok(!args.includes('--session-id'));
  assert.equal(args[args.indexOf('--resume') + 1], 'uuid-1');
});

test('buildArgs passes --model when a model is given, omits it otherwise', () => {
  const withModel = buildArgs({ mode: 'spawn', sessionId: 'x', model: 'claude-opus-4-8' });
  assert.equal(withModel[withModel.indexOf('--model') + 1], 'claude-opus-4-8');
  assert.ok(!buildArgs({ mode: 'spawn', sessionId: 'x' }).includes('--model'));
});

test('buildArgs can omit the bypass flag when autonomy is dialed down', () => {
  const args = buildArgs({ mode: 'spawn', sessionId: 'x', dangerouslySkipPermissions: false });
  assert.ok(!args.includes('--dangerously-skip-permissions'));
});

test('reduceStreamEvents pulls sessionId, model, resultText and duration', () => {
  const events = [
    { type: 'system', subtype: 'init', model: 'claude-opus-4-8', session_id: 'sid-9' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'working...' }] } },
    { type: 'result', subtype: 'success', result: 'Created hello.txt', duration_ms: 4200 },
  ];
  const r = reduceStreamEvents(events);
  assert.equal(r.sessionId, 'sid-9');
  assert.equal(r.model, 'claude-opus-4-8');
  assert.equal(r.resultText, 'Created hello.txt');
  assert.equal(r.durationMs, 4200);
});

test('reduceStreamEvents falls back to assistant text when no result event', () => {
  const events = [
    { type: 'system', subtype: 'init', model: 'm', session_id: 's' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'partial answer' }] } },
  ];
  assert.equal(reduceStreamEvents(events).resultText, 'partial answer');
});

// Fake child process: emits canned NDJSON on stdout, then closes.
function makeFakeSpawn(ndjsonLines, exitCode = 0) {
  const children = [];
  const spawnFn = (_cmd, args) => {
    const child = new EventEmitter();
    child.args = args;
    child.stdin = { data: '', write(s) { this.data += s; }, end() { this.ended = true; } };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    children.push(child);
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(ndjsonLines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
      child.emit('close', exitCode);
    });
    return child;
  };
  return { spawnFn, children };
}

test('runClaude writes the prompt to stdin and resolves the parsed result', async () => {
  const { spawnFn, children } = makeFakeSpawn([
    { type: 'system', subtype: 'init', model: 'claude-opus-4-8', session_id: 'sid-run' },
    { type: 'result', subtype: 'success', result: 'done', duration_ms: 10 },
  ]);

  const res = await runClaude({
    mode: 'spawn',
    sessionId: 'sid-run',
    prompt: 'create hello.txt',
    cwd: '/tmp',
    spawnFn,
  });

  assert.equal(res.success, true);
  assert.equal(res.sessionId, 'sid-run');
  assert.equal(res.resultText, 'done');
  assert.equal(children[0].stdin.data, 'create hello.txt');
  assert.equal(children[0].stdin.ended, true);
});

test('runClaude reports failure on a non-zero exit', async () => {
  const { spawnFn } = makeFakeSpawn([], 1);
  const res = await runClaude({ mode: 'spawn', sessionId: 'x', prompt: 'hi', cwd: '/tmp', spawnFn });
  assert.equal(res.success, false);
  assert.equal(res.exitCode, 1);
});

test('runClaude enforces the timeout (exitCode 124) when the session runs too long', async () => {
  // a child that never closes → the timeout must fire
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdin = { write() {}, end() {} };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    return child;
  };
  const res = await runClaude({ mode: 'spawn', sessionId: 'x', prompt: 'hi', cwd: '/tmp', spawnFn, timeoutMs: 25 });
  assert.equal(res.success, false);
  assert.equal(res.exitCode, 124);
});

test('runClaude forwards the model to the CLI args', async () => {
  const { spawnFn, children } = makeFakeSpawn([
    { type: 'result', subtype: 'success', result: 'ok', duration_ms: 1 },
  ]);
  await runClaude({ mode: 'spawn', sessionId: 'x', prompt: 'hi', cwd: '/tmp', model: 'sonnet', spawnFn });
  assert.equal(children[0].args[children[0].args.indexOf('--model') + 1], 'sonnet');
});

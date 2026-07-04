import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appleScript, notifyDesktop } from '../lib/notify.mjs';

test('appleScript builds a display-notification with title + sound', () => {
  const s = appleScript({ title: 'cc', message: 'done', sound: true });
  assert.match(s, /display notification "done" with title "cc"/);
  assert.match(s, /sound name "Ping"/);
});

test('appleScript escapes quotes/backslashes and flattens newlines', () => {
  const s = appleScript({ title: 'a"b', message: 'x"y\\z\nnext', sound: false });
  assert.match(s, /display notification "x\\"y\\\\z next" with title "a\\"b"/);
  assert.ok(!s.includes('sound name'));
});

test('notifyDesktop is a no-op off macOS', () => {
  let called = false;
  const spawnFn = () => { called = true; return new EventEmitter(); };
  assert.equal(notifyDesktop({ title: 't', message: 'm', spawnFn, platform: 'linux' }), false);
  assert.equal(called, false);
});

test('notifyDesktop shells out to osascript on macOS', () => {
  const calls = [];
  const spawnFn = (cmd, args) => { calls.push({ cmd, args }); return new EventEmitter(); };
  assert.equal(notifyDesktop({ title: 't', message: 'm', spawnFn, platform: 'darwin' }), true);
  assert.equal(calls[0].cmd, 'osascript');
  assert.equal(calls[0].args[0], '-e');
  assert.match(calls[0].args[1], /display notification "m" with title "t"/);
});

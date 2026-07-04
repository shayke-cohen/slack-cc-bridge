import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGate } from '../lib/guard.mjs';

const config = { channel: 'DC793D3D3', author: 'UC74Z40NN' };

test('allows a genuine self-authored message in the monitored channel', () => {
  const r = checkGate({ author: 'UC74Z40NN', channel: 'DC793D3D3' }, config);
  assert.equal(r.allowed, true);
});

test('rejects a message from a different author', () => {
  const r = checkGate({ author: 'U999OTHER', channel: 'DC793D3D3' }, config);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /author/i);
});

test('rejects a message in a different channel', () => {
  const r = checkGate({ author: 'UC74Z40NN', channel: 'CSOMETHING' }, config);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /channel/i);
});

test('rejects our own bot post (bot_id present)', () => {
  const r = checkGate(
    { author: 'UC74Z40NN', channel: 'DC793D3D3', botId: 'B0967JZKK9N' },
    config,
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason, /bot/i);
});

test('rejects when author or channel is missing', () => {
  assert.equal(checkGate({ channel: 'DC793D3D3' }, config).allowed, false);
  assert.equal(checkGate({ author: 'UC74Z40NN' }, config).allowed, false);
});

test('allows the author in ANY configured channel (multi-channel, incl. private)', () => {
  const multi = { channels: ['C_PRIV1', 'C_PRIV2'], author: 'UC74Z40NN' };
  assert.equal(checkGate({ author: 'UC74Z40NN', channel: 'C_PRIV2' }, multi).allowed, true);
  assert.equal(checkGate({ author: 'UC74Z40NN', channel: 'C_NOPE' }, multi).allowed, false);
});

test('channel (singular) and channels (array) are merged', () => {
  const both = { channel: 'DC793D3D3', channels: ['C_PRIV1'], author: 'UC74Z40NN' };
  assert.equal(checkGate({ author: 'UC74Z40NN', channel: 'DC793D3D3' }, both).allowed, true);
  assert.equal(checkGate({ author: 'UC74Z40NN', channel: 'C_PRIV1' }, both).allowed, true);
});

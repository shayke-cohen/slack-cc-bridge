import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/classify.mjs';

const config = { author: 'UC74Z40NN', channels: ['C_A', 'C_B'], trigger: '@cc', defaultModel: 'claude-opus-4-8' };

test('newTasks = only @cc top-level from the author in this channel, after its cursor, tagged with the channel', () => {
  const input = {
    channelId: 'C_A',
    messages: [
      { user: 'UC74Z40NN', ts: '200.000000', text: '@cc do task A' },
      { user: 'UC74Z40NN', ts: '201.000000', text: 'random note to self' },
      { user: 'UC74Z40NN', ts: '202.000000', text: '@cc(sonnet) task B' },
      { user: 'UC74Z40NN', ts: '150.000000', text: '@cc too old' },
      { user: 'UC74Z40NN', ts: '203.000000', bot_id: 'B1', text: '@cc from our bot' },
      { user: 'UOTHER', ts: '204.000000', text: '@cc from someone else' },
      { user: 'UC74Z40NN', ts: '205.000000', thread_ts: '200.000000', text: '@cc a reply' },
    ],
    threads: {},
  };
  const state = { threads: {}, lastSeen: { C_A: '199.000000' } };
  const { newTasks, maxTs } = classify(input, state, config);
  assert.deepEqual(newTasks, [
    { channel: 'C_A', thread: '200.000000', text: 'do task A', model: 'claude-opus-4-8' },
    { channel: 'C_A', thread: '202.000000', text: 'task B', model: 'sonnet' },
  ]);
  assert.equal(maxTs, '205.000000');
});

test('per-channel cursor: the SAME message ts in a different channel is still new', () => {
  const input = { channelId: 'C_B', messages: [{ user: 'UC74Z40NN', ts: '200.000000', text: '@cc in B' }], threads: {} };
  // C_A cursor is past 200, but C_B has never been seen
  const state = { threads: {}, lastSeen: { C_A: '999.000000' } };
  const { newTasks } = classify(input, state, config);
  assert.deepEqual(newTasks, [{ channel: 'C_B', thread: '200.000000', text: 'in B', model: 'claude-opus-4-8' }]);
});

test('threadTurns (no coalescing) = author replies in an active thread of THIS channel', () => {
  const input = {
    channelId: 'C_A',
    messages: [],
    threads: {
      '200.000000': [
        { user: 'UC74Z40NN', ts: '200.000000', text: '@cc root' },
        { user: 'UC74Z40NN', ts: '206.000000', bot_id: 'B1', text: 'ack' },
        { user: 'UC74Z40NN', ts: '207.000000', text: 'also add tests' },
        { user: 'UC74Z40NN', ts: '208.000000', text: 'and docs' },
      ],
    },
  };
  const state = { threads: { '200.000000': { sessionId: 's1', channel: 'C_A', lastReplyTs: '200.000000' } }, lastSeen: {} };
  const { threadTurns } = classify(input, state, { ...config, coalesceReplies: false });
  assert.deepEqual(threadTurns, [
    { channel: 'C_A', thread: '200.000000', ts: '207.000000', text: 'also add tests' },
    { channel: 'C_A', thread: '200.000000', ts: '208.000000', text: 'and docs' },
  ]);
});

test('coalescing merges rapid replies into one channel-tagged turn', () => {
  const input = {
    channelId: 'C_A',
    messages: [],
    threads: { '200.000000': [
      { user: 'UC74Z40NN', ts: '207.000000', text: 'also add tests' },
      { user: 'UC74Z40NN', ts: '208.000000', text: 'and docs' },
    ] },
  };
  const state = { threads: { '200.000000': { sessionId: 's1', channel: 'C_A', lastReplyTs: '206.000000' } }, lastSeen: {} };
  const { threadTurns } = classify(input, state, config);
  assert.deepEqual(threadTurns, [
    { channel: 'C_A', thread: '200.000000', ts: '208.000000', text: 'also add tests\nand docs' },
  ]);
});

test('a thread belonging to a DIFFERENT channel is not followed in this channel', () => {
  const input = { channelId: 'C_A', messages: [], threads: { '200.000000': [{ user: 'UC74Z40NN', ts: '207.000000', text: 'x' }] } };
  const state = { threads: { '200.000000': { sessionId: 's1', channel: 'C_B', lastReplyTs: '206.000000' } }, lastSeen: {} };
  assert.deepEqual(classify(input, state, config).threadTurns, []);
});

test('replies in a CLOSED thread are ignored', () => {
  const input = { channelId: 'C_A', messages: [], threads: { '200.000000': [{ user: 'UC74Z40NN', ts: '207.000000', text: 'more' }] } };
  const state = { threads: { '200.000000': { sessionId: 's1', channel: 'C_A', status: 'closed', lastReplyTs: '206.000000' } }, lastSeen: {} };
  assert.deepEqual(classify(input, state, config).threadTurns, []);
});

test('maxTs falls back to the channel cursor when there are no messages', () => {
  const { maxTs } = classify({ channelId: 'C_A', messages: [], threads: {} }, { threads: {}, lastSeen: { C_A: '1783080398.898029' } }, config);
  assert.equal(maxTs, '1783080398.898029');
});

test('back-compat: old {channel:[...]} + lastSeenTs still work (single-channel config)', () => {
  const legacyCfg = { author: 'UC74Z40NN', channel: 'DC793D3D3', trigger: '@cc', defaultModel: 'claude-opus-4-8' };
  const input = { channel: [{ user: 'UC74Z40NN', ts: '10.0', text: '@cc hi' }], threads: {} };
  const { newTasks } = classify(input, { threads: {}, lastSeenTs: '5.0' }, legacyCfg);
  assert.deepEqual(newTasks, [{ channel: 'DC793D3D3', thread: '10.0', text: 'hi', model: 'claude-opus-4-8' }]);
});

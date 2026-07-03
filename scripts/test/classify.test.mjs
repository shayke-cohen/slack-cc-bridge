import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/classify.mjs';

const config = { author: 'UC74Z40NN', channel: 'DC793D3D3', trigger: '@cc', defaultModel: 'claude-opus-4-8' };

test('newTasks = only @cc top-level messages from the author, after the cursor', () => {
  const input = {
    channel: [
      { user: 'UC74Z40NN', ts: '200.000000', text: '@cc do task A' },
      { user: 'UC74Z40NN', ts: '201.000000', text: 'random note to self' },
      { user: 'UC74Z40NN', ts: '202.000000', text: '@cc(sonnet) task B' },
      { user: 'UC74Z40NN', ts: '150.000000', text: '@cc too old' },
      { user: 'UC74Z40NN', ts: '203.000000', bot_id: 'B1', text: '@cc from our bot' },
      { user: 'UOTHER', ts: '204.000000', text: '@cc from someone else' },
      { user: 'UC74Z40NN', ts: '205.000000', thread_ts: '200.000000', text: '@cc a reply, not top-level' },
    ],
    threads: {},
  };
  const { newTasks, maxTs } = classify(input, { threads: {}, lastSeenTs: '199.000000' }, config);
  assert.deepEqual(newTasks, [
    { thread: '200.000000', text: 'do task A', model: 'claude-opus-4-8' },
    { thread: '202.000000', text: 'task B', model: 'sonnet' },
  ]);
  // cursor advances past ALL examined messages (even skipped) so they're not refetched.
  assert.equal(maxTs, '205.000000');
});

test('threadTurns (no coalescing) = ALL user replies in an active thread, minus root + bot + seen', () => {
  const input = {
    channel: [],
    threads: {
      '200.000000': [
        { user: 'UC74Z40NN', ts: '200.000000', text: '@cc do task A' }, // root
        { user: 'UC74Z40NN', ts: '206.000000', bot_id: 'B1', text: 'ack' }, // our bot post
        { user: 'UC74Z40NN', ts: '207.000000', text: 'also add tests' },
        { user: 'UC74Z40NN', ts: '208.000000', text: 'and docs' },
      ],
    },
  };
  const state = { threads: { '200.000000': { sessionId: 's1', lastReplyTs: '200.000000' } }, lastSeenTs: '199.000000' };
  const { threadTurns } = classify(input, state, { ...config, coalesceReplies: false });
  assert.deepEqual(threadTurns, [
    { thread: '200.000000', ts: '207.000000', text: 'also add tests' },
    { thread: '200.000000', ts: '208.000000', text: 'and docs' },
  ]);
});

test('coalescing merges rapid replies in a thread into ONE turn (one resume, not many)', () => {
  const input = {
    channel: [],
    threads: {
      '200.000000': [
        { user: 'UC74Z40NN', ts: '207.000000', text: 'also add tests' },
        { user: 'UC74Z40NN', ts: '208.000000', text: 'and docs' },
      ],
    },
  };
  const state = { threads: { '200.000000': { sessionId: 's1', lastReplyTs: '206.000000' } }, lastSeenTs: '0' };
  const { threadTurns } = classify(input, state, config); // coalesceReplies defaults on
  assert.deepEqual(threadTurns, [
    { thread: '200.000000', ts: '208.000000', text: 'also add tests\nand docs' },
  ]);
});

test('replies in a CLOSED thread are ignored', () => {
  const input = {
    channel: [],
    threads: { '200.000000': [{ user: 'UC74Z40NN', ts: '207.000000', text: 'more' }] },
  };
  const state = { threads: { '200.000000': { sessionId: 's1', status: 'closed', lastReplyTs: '206.000000' } }, lastSeenTs: '0' };
  assert.deepEqual(classify(input, state, config).threadTurns, []);
});

test('threadTurns respects the per-thread lastReplyTs cursor', () => {
  const input = {
    channel: [],
    threads: {
      '200.000000': [
        { user: 'UC74Z40NN', ts: '207.000000', text: 'first reply' },
        { user: 'UC74Z40NN', ts: '208.000000', text: 'second reply' },
      ],
    },
  };
  const state = { threads: { '200.000000': { sessionId: 's1', lastReplyTs: '207.000000' } }, lastSeenTs: '0' };
  const { threadTurns } = classify(input, state, config);
  assert.deepEqual(threadTurns, [{ thread: '200.000000', ts: '208.000000', text: 'second reply' }]);
});

test('replies in a thread with no active session are ignored', () => {
  const input = { channel: [], threads: { '999.000000': [{ user: 'UC74Z40NN', ts: '999.500000', text: 'stray' }] } };
  const { threadTurns } = classify(input, { threads: {}, lastSeenTs: '0' }, config);
  assert.deepEqual(threadTurns, []);
});

test('maxTs falls back to the existing cursor when the channel is empty', () => {
  const { maxTs } = classify({ channel: [], threads: {} }, { threads: {}, lastSeenTs: '1783080398.898029' }, config);
  assert.equal(maxTs, '1783080398.898029');
});

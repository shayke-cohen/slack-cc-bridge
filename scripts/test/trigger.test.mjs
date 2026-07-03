import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrigger } from '../lib/trigger.mjs';

const opts = { trigger: '@cc', defaultModel: 'claude-opus-4-8' };

test('a plain @cc message is a task with the default model', () => {
  const r = parseTrigger('@cc fix the login bug', opts);
  assert.equal(r.isTask, true);
  assert.equal(r.task, 'fix the login bug');
  assert.equal(r.model, 'claude-opus-4-8');
});

test('a (model) override right after the trigger is honored', () => {
  const r = parseTrigger('@cc(sonnet) refactor the parser', opts);
  assert.equal(r.isTask, true);
  assert.equal(r.task, 'refactor the parser');
  assert.equal(r.model, 'sonnet');
});

test('the trigger match is case-insensitive', () => {
  const r = parseTrigger('@CC do the thing', opts);
  assert.equal(r.isTask, true);
  assert.equal(r.task, 'do the thing');
});

test('leading whitespace before the trigger is allowed', () => {
  assert.equal(parseTrigger('   @cc spaced', opts).isTask, true);
});

test('a non-@cc note to self is NOT a task', () => {
  assert.equal(parseTrigger('remember to renew the cert', opts).isTask, false);
  assert.equal(parseTrigger('email boris @cc later', opts).isTask, false); // trigger not at start
});

test('@cc must be its own token, not a prefix of another word', () => {
  assert.equal(parseTrigger('@ccfoo bar', opts).isTask, false);
});

test('multiline task text is preserved after the trigger', () => {
  const r = parseTrigger('@cc build X\nwith Y\nand Z', opts);
  assert.equal(r.isTask, true);
  assert.equal(r.task, 'build X\nwith Y\nand Z');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToSlack } from '../lib/slackfmt.mjs';

test('**bold** / __bold__ become *bold* (Slack bold)', () => {
  assert.equal(mdToSlack('hello **world** and __you__'), 'hello *world* and *you*');
});

test('# headings become a bold line (Slack has no headings)', () => {
  assert.equal(mdToSlack('## Bottom line\ntext'), '*Bottom line*\ntext');
});

test('[text](url) becomes <url|text>', () => {
  assert.equal(mdToSlack('see [Claude](https://claude.ai) now'), 'see <https://claude.ai|Claude> now');
});

test('- / * / + bullets become • ', () => {
  assert.equal(mdToSlack('- one\n* two\n+ three'), '• one\n• two\n• three');
});

test('~~strike~~ becomes ~strike~', () => {
  assert.equal(mdToSlack('~~old~~'), '~old~');
});

test('fenced code has its language hint stripped, body preserved', () => {
  assert.equal(mdToSlack('```js\nconst x = 1;\n```'), '```\nconst x = 1;\n```');
});

test('markdown inside code is NOT converted (inline + fenced are protected)', () => {
  assert.equal(mdToSlack('use `**stay**` inline'), 'use `**stay**` inline');
  assert.equal(mdToSlack('```\n## keep\n**keep**\n```'), '```\n## keep\n**keep**\n```');
});

test('a realistic mixed block converts cleanly', () => {
  const md = '## Result\n\nWe should **not** — see [docs](https://x.io).\n\n- a\n- b';
  assert.equal(
    mdToSlack(md),
    '*Result*\n\nWe should *not* — see <https://x.io|docs>.\n\n• a\n• b',
  );
});

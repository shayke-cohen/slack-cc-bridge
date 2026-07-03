import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTranscriptFrom, extractEndTurnText, tailAssistantText } from '../lib/tail.mjs';

const LINES = [
  { type: 'user', message: { role: 'user', content: 'hello' } },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
      stop_reason: 'tool_use',
    },
  },
  {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
  },
  {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Done: created hello.txt' }],
      stop_reason: 'end_turn',
    },
  },
];

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sccb-tail-'));
  const p = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}

test('readTranscriptFrom reads user+assistant entries and advances offset to EOF', () => {
  const p = writeTranscript(LINES);
  const { entries, newOffset } = readTranscriptFrom(p, 0);
  assert.equal(entries.length, 4);
  assert.equal(newOffset, fs.statSync(p).size);
});

test('extractEndTurnText returns only assistant end_turn text (skips tool_use + user)', () => {
  const { entries } = readTranscriptFrom(writeTranscript(LINES), 0);
  assert.deepEqual(extractEndTurnText(entries), ['Done: created hello.txt']);
});

test('tailAssistantText only emits turns appended since the stored offset', () => {
  const p = writeTranscript(LINES);
  const first = tailAssistantText(p, 0);
  assert.deepEqual(first.texts, ['Done: created hello.txt']);

  // Simulate a manual VS Code continuation appended to the same transcript.
  fs.appendFileSync(
    p,
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Renamed to hi.txt' }],
        stop_reason: 'end_turn',
      },
    }) + '\n',
  );

  const second = tailAssistantText(p, first.newOffset);
  assert.deepEqual(second.texts, ['Renamed to hi.txt']);
});

test('tailAssistantText at EOF offset is a no-op', () => {
  const p = writeTranscript(LINES);
  const size = fs.statSync(p).size;
  const r = tailAssistantText(p, size);
  assert.deepEqual(r.texts, []);
  assert.equal(r.newOffset, size);
});

test('readTranscriptFrom on a missing file returns empty without throwing', () => {
  const r = readTranscriptFrom('/no/such/transcript.jsonl', 0);
  assert.deepEqual(r.entries, []);
  assert.equal(r.newOffset, 0);
});

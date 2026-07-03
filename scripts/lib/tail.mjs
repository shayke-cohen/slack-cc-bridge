/**
 * Incremental transcript reader for the reverse (session -> Slack) direction.
 *
 * `readTranscriptFrom` is ported from ck-internal-bi/hooks/bi-utils.js: it reads a
 * session's ~/.claude/projects/<hash>/<uuid>.jsonl from a byte offset and returns the
 * new user/assistant records + the new offset. `extractEndTurnText` pulls the final
 * assistant text of each completed turn (stop_reason === 'end_turn'), which is what we
 * mirror into the Slack thread — including turns a human drove manually in VS Code.
 */
import fs from 'node:fs';

/**
 * @param {string} transcriptPath
 * @param {number} byteOffset
 * @returns {{entries: object[], newOffset: number}}
 */
export function readTranscriptFrom(transcriptPath, byteOffset) {
  try {
    if (!transcriptPath) return { entries: [], newOffset: byteOffset };
    let stat;
    try {
      stat = fs.statSync(transcriptPath);
    } catch {
      return { entries: [], newOffset: byteOffset };
    }
    if (stat.size <= byteOffset) return { entries: [], newOffset: byteOffset };

    const buffer = Buffer.alloc(stat.size - byteOffset);
    const fd = fs.openSync(transcriptPath, 'r');
    let bytesRead;
    try {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, byteOffset);
    } finally {
      fs.closeSync(fd);
    }

    const text = buffer.slice(0, bytesRead).toString('utf8');
    const lines = text.split('\n').filter((l) => l.trim());
    const entries = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const kind = entry.type ?? entry.role;
        if (kind === 'user' || kind === 'assistant') {
          if (!entry.type) entry.type = kind;
          entries.push(entry);
        }
      } catch {
        /* skip malformed / partial trailing lines */
      }
    }
    return { entries, newOffset: byteOffset + bytesRead };
  } catch {
    return { entries: [], newOffset: byteOffset };
  }
}

/**
 * Final assistant text for each completed turn.
 * @param {object[]} entries
 * @returns {string[]}
 */
export function extractEndTurnText(entries) {
  const out = [];
  for (const entry of entries) {
    if (entry.type !== 'assistant') continue;
    const message = entry.message;
    if (!message || message.stop_reason !== 'end_turn') continue;
    const content = Array.isArray(message.content) ? message.content : [];
    const text = content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * Convenience: read new records from `byteOffset` and return their end_turn texts + new offset.
 * @param {string} transcriptPath
 * @param {number} byteOffset
 * @returns {{texts: string[], newOffset: number}}
 */
export function tailAssistantText(transcriptPath, byteOffset) {
  const { entries, newOffset } = readTranscriptFrom(transcriptPath, byteOffset);
  return { texts: extractEndTurnText(entries), newOffset };
}

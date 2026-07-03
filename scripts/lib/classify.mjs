/**
 * Turn a raw Slack poll into a clean, deduped action list — deterministically, so the
 * orchestrator LLM barely reasons per tick (efficiency) and never re-processes a message
 * (no noise). This is where the self-only gate, the `@cc` opt-in trigger, and the cursors
 * all combine.
 *
 * newTasks  = top-level messages the author started with the trigger, newer than lastSeenTs.
 * threadTurns = ALL author replies (no trigger needed) in an already-active thread, newer
 *              than that thread's lastReplyTs, excluding the root and our own bot posts.
 */
import { checkGate } from './guard.mjs';
import { parseTrigger } from './trigger.mjs';

/** Exact Slack-ts ordering key (seconds.microseconds) as BigInt — avoids float rounding. */
function tsKey(ts) {
  const [s, f = '0'] = String(ts).split('.');
  return BigInt(s) * 1000000n + BigInt(f.padEnd(6, '0').slice(0, 6));
}
const tsGt = (a, b) => tsKey(a) > tsKey(b);

/**
 * @param {{channel: object[], threads: Record<string, object[]>}} input
 * @param {{threads: Record<string, {lastReplyTs?: string}>, lastSeenTs: string}} state
 * @param {{author: string, channel: string, trigger: string, defaultModel: string}} config
 * @returns {{newTasks: object[], threadTurns: object[], maxTs: string}}
 */
export function classify(input, state, config) {
  const channel = input.channel ?? [];
  const threads = input.threads ?? {};
  const newTasks = [];
  let maxTs = state.lastSeenTs ?? '0';

  for (const msg of channel) {
    if (tsGt(msg.ts, maxTs)) maxTs = msg.ts;

    const topLevel = !msg.thread_ts || msg.thread_ts === msg.ts;
    if (!topLevel) continue;
    if (!tsGt(msg.ts, state.lastSeenTs ?? '0')) continue;
    if (!checkGate({ author: msg.user, channel: config.channel, botId: msg.bot_id }, config).allowed) continue;

    const parsed = parseTrigger(msg.text ?? '', config);
    if (!parsed.isTask) continue;
    newTasks.push({ thread: msg.ts, text: parsed.task, model: parsed.model });
  }

  const coalesce = config.coalesceReplies !== false;
  const threadTurns = [];
  for (const [threadTs, replies] of Object.entries(threads)) {
    const entry = state.threads?.[threadTs];
    if (!entry || entry.status === 'closed') continue; // only follow active threads
    const cursor = entry.lastReplyTs ?? threadTs;
    const turns = [];
    for (const r of replies ?? []) {
      if (r.ts === threadTs) continue; // the root message
      if (!tsGt(r.ts, cursor)) continue;
      if (!checkGate({ author: r.user, channel: config.channel, botId: r.bot_id }, config).allowed) continue;
      turns.push({ thread: threadTs, ts: r.ts, text: r.text ?? '' });
    }
    if (!turns.length) continue;
    if (coalesce) {
      // merge rapid replies → one resume, cursor at the last reply
      threadTurns.push({ thread: threadTs, ts: turns[turns.length - 1].ts, text: turns.map((t) => t.text).join('\n') });
    } else {
      threadTurns.push(...turns);
    }
  }

  return { newTasks, threadTurns, maxTs };
}

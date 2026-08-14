/**
 * Wake any headless agent that is sitting in `agent-ask-user-in-slack`, waiting on a Slack answer.
 *
 * That skill's waits sleep in escalating slices (up to ~2 min) because it has no way to watch Slack
 * itself — it polls through its agent. We DO watch Slack, every tick. So the moment we see the user
 * say anything in a monitored channel, we can collapse a waiting agent's backoff to nothing.
 *
 * The coupling is deliberately one file deep: the contract is "touch a file in that skill's kick
 * directory". We never import its code, never read its state, and never require it to be installed.
 * A missing directory means it isn't installed (or has nothing waiting) — a silent no-op, not an
 * error. Never throws.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_ASK_KICK_DIR = path.join(
  os.homedir(), '.claude', 'state', 'agent-ask-user-in-slack', 'kick',
);

/** Expand a leading `~` so config may carry either form. */
export function resolveKickDir(dir) {
  if (!dir) return DEFAULT_ASK_KICK_DIR;
  return dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir;
}

/**
 * Touch the ALL sentinel, which wakes every waiting ask. We use ALL rather than a per-thread file
 * because the bridge does not know which ask belongs to which thread — and an extra wake costs one
 * early poll, while a missed wake costs the user up to two minutes of an agent doing nothing.
 *
 * @param {{kickDir?: string, fsImpl?: object}} o
 * @returns {{kicked: string|null, reason?: string}}
 */
export function kickWaitingAsks({ kickDir, fsImpl = fs } = {}) {
  const dir = resolveKickDir(kickDir);
  try {
    if (!fsImpl.existsSync(dir)) return { kicked: null, reason: 'no kick dir — skill not installed' };
    const target = path.join(dir, 'ALL');
    fsImpl.writeFileSync(target, '');
    return { kicked: target };
  } catch (e) {
    return { kicked: null, reason: `kick failed: ${e.message}` };
  }
}

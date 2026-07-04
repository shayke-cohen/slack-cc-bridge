/**
 * Best-effort LOCAL desktop notification. The Slack self-DM can never notify you (the MCP posts
 * as YOU, and Slack suppresses self-notifications), so we alert on the machine the orchestrator
 * runs on. macOS via `osascript`; a silent no-op elsewhere. Never throws.
 */
import { spawn as nodeSpawn } from 'node:child_process';

/** Build the AppleScript `display notification` string, escaping for a double-quoted AS literal. */
export function appleScript({ title, message, sound = true }) {
  const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
  let script = `display notification "${esc(message)}" with title "${esc(title)}"`;
  if (sound) script += ' sound name "Ping"';
  return script;
}

/**
 * Fire a desktop notification. Returns true if it dispatched, false if skipped (non-macOS/error).
 * @param {{title: string, message: string, sound?: boolean, spawnFn?: Function, platform?: string}} o
 */
export function notifyDesktop({ title, message, sound = true, spawnFn = nodeSpawn, platform = process.platform }) {
  if (platform !== 'darwin') return false;
  try {
    spawnFn('osascript', ['-e', appleScript({ title, message, sound })], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

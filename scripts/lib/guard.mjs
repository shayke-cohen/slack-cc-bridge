/**
 * Self-only gate. The bridge grants FULL autonomy (--dangerously-skip-permissions)
 * to spawned sessions, so it must NEVER act on anything but genuinely self-authored
 * messages in the one monitored channel. This is the script-side half of the
 * defense-in-depth gate (the skill filters too).
 *
 * @param {{author?: string, channel?: string, botId?: string}} msg
 * @param {{author: string, channel: string}} config
 * @returns {{allowed: boolean, reason: string}}
 */
export function checkGate(msg, config) {
  const { author, channel, botId } = msg ?? {};

  if (botId) {
    return { allowed: false, reason: `blocked: message is a bot post (bot_id=${botId})` };
  }
  if (!author || !channel) {
    return { allowed: false, reason: 'blocked: missing author or channel' };
  }
  if (channel !== config.channel) {
    return { allowed: false, reason: `blocked: channel ${channel} is not the monitored channel` };
  }
  if (author !== config.author) {
    return { allowed: false, reason: `blocked: author ${author} is not the allowed self user` };
  }
  return { allowed: true, reason: 'ok' };
}

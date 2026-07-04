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
/**
 * The set of monitored channels: `config.channels` (array) plus `config.channel` (singular,
 * back-compat). Any channel the user can see — including private ones — is fine, since the
 * Slack MCP acts as the user.
 * @param {{channel?: string, channels?: string[]}} config
 * @returns {string[]}
 */
export function allowedChannels(config) {
  const list = Array.isArray(config?.channels) ? config.channels.filter(Boolean) : [];
  if (config?.channel && !list.includes(config.channel)) list.unshift(config.channel);
  return list;
}

export function checkGate(msg, config) {
  const { author, channel, botId } = msg ?? {};

  if (botId) {
    return { allowed: false, reason: `blocked: message is a bot post (bot_id=${botId})` };
  }
  if (!author || !channel) {
    return { allowed: false, reason: 'blocked: missing author or channel' };
  }
  if (!allowedChannels(config).includes(channel)) {
    return { allowed: false, reason: `blocked: channel ${channel} is not a monitored channel` };
  }
  if (author !== config.author) {
    return { allowed: false, reason: `blocked: author ${author} is not the allowed self user` };
  }
  return { allowed: true, reason: 'ok' };
}

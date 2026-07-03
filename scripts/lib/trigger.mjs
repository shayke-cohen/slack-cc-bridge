/**
 * Opt-in trigger parsing. The self-DM doubles as a notes-to-self scratchpad, so a new
 * session starts ONLY on a message whose first token is the trigger (default `@cc`).
 * An optional `(model)` right after the trigger overrides the default model for that task.
 * Replies inside an already-active thread do NOT need the trigger — the caller handles those.
 *
 *   "@cc fix the bug"        -> { isTask:true, task:"fix the bug", model:<default> }
 *   "@cc(sonnet) refactor"   -> { isTask:true, task:"refactor",   model:"sonnet" }
 *   "a note to self"         -> { isTask:false }
 *
 * @param {string} text
 * @param {{trigger?: string, defaultModel?: string}} [opts]
 * @returns {{isTask: boolean, task?: string, model?: string}}
 */
export function parseTrigger(text, { trigger = '@cc', defaultModel = 'claude-opus-4-8' } = {}) {
  const t = String(text ?? '').replace(/^\s+/, '');
  const lead = t.slice(0, trigger.length).toLowerCase();
  if (lead !== trigger.toLowerCase()) return { isTask: false };

  // The trigger must be its own token: followed by whitespace, '(', or end-of-string.
  const after = t.slice(trigger.length);
  if (after.length && !/^[\s(]/.test(after)) return { isTask: false };

  let rest = after;
  let model = defaultModel;

  const modelMatch = rest.match(/^\s*\(([^)]+)\)/);
  if (modelMatch) {
    model = modelMatch[1].trim();
    rest = rest.slice(modelMatch[0].length);
  }

  return { isTask: true, task: rest.replace(/^\s+/, ''), model };
}

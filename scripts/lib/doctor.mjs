/**
 * Config sanity check for a fresh install. Pure over an already-loaded config (or null when
 * config.json is missing), so the installing agent can run `bridge doctor` and get a clear
 * checklist of what still needs setting. It cannot check Slack connectivity — that lives in
 * the MCP (only reachable from a Claude session), so the skill's setup flow covers that.
 */
import fs from 'node:fs';
import path from 'node:path';

const blank = (v) => v == null || String(v).trim() === '';

/**
 * @param {object|null} config
 * @returns {{ok: boolean, checks: Array<{name: string, ok: boolean, hint?: string}>}}
 */
export function runDoctor(config) {
  const checks = [];
  const add = (name, ok, hint) => checks.push(ok ? { name, ok } : { name, ok, hint });

  if (!config) {
    add('config.json present', false, 'copy config.example.json → config.json, then fill it in');
    return { ok: false, checks };
  }

  add('channel set', !blank(config.channel), 'set config.channel to your Slack DM channel id (looks like D0…)');
  add('author set', !blank(config.author), 'set config.author to your Slack user id (looks like U0…)');
  add(
    'baseRepo is a git repo',
    !blank(config.baseRepo) && fs.existsSync(path.join(config.baseRepo, '.git')),
    'baseRepo must be an existing git repository (worktrees are cut from it)',
  );
  add(
    'listWorkspace exists',
    !blank(config.listWorkspace) && fs.existsSync(config.listWorkspace),
    'listWorkspace must be an existing folder — the one you keep open in VS Code',
  );
  add('worktreeRoot set', !blank(config.worktreeRoot), 'set worktreeRoot to an absolute path for per-thread worktrees');

  return { ok: checks.every((c) => c.ok), checks };
}

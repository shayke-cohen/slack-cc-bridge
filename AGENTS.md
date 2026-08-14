# AGENTS.md — slack-cc-bridge

Cross-agent guide for **using** and **maintaining** this skill. It works with any agent that
loads the `SKILL.md` convention — **Claude Code** and **Codex** are both first-class.

## What this is

A skill that drives coding-agent sessions from a Slack self-DM: a message typed as
**`@cc <task>`** spawns an isolated, editor-visible headless `claude` session; replies in that
thread continue it. See `README.md` for the full picture and `SKILL.md` for the orchestrator
runbook the host agent follows.

## Two layers

- **`SKILL.md`** — the orchestrator runbook (host-agent-specific: it makes Slack MCP calls and
  drives the loop). Loaded by Claude Code (`~/.claude/skills/`) or Codex (`~/.codex/skills/`).
- **`scripts/bridge.mjs`** — a **zero-dependency Node CLI**, completely agent-agnostic. It owns
  the self-only gate, `@cc` trigger, git worktrees, spawning/resuming `claude`, transcript
  tailing, and state. Any agent (or a plain shell) can call it. This is why the skill ports
  cleanly across hosts — only the thin Slack-I/O layer is host-specific.

## Install

Skills are auto-discovered from the host's skills dir, so clone (or symlink) this repo there:

| Host | Global skills dir | Project skills dir |
|------|-------------------|--------------------|
| Claude Code | `~/.claude/skills/slack-cc-bridge/` | `.claude/skills/…` |
| Codex | `~/.codex/skills/slack-cc-bridge/` | `.agents/skills/…` |

Same machine, one source of truth: symlink the second host at the first, e.g.
`ln -s ~/.claude/skills/slack-cc-bridge ~/.codex/skills/slack-cc-bridge`.

Then `cp config.example.json config.json` and configure it (see **Setup** in `README.md`).

## Run

- **Claude Code:** `/loop 45s /slack-cc-bridge` (ideally on Haiku).
- **Codex:** `/slack-cc-bridge` (the `user-invocable: true` frontmatter exposes it as a slash command).

Then type `@cc <task>` in the monitored Slack self-DM.

## Portability notes for maintainers

- **Slack MCP tool names are host-specific.** `SKILL.md` shows this environment's names
  (`mcp__Webrix__slack__…`); on another host/agent use its equivalent Slack MCP tools
  (`get_channel_history`, `get_thread_replies`, `reply_to_thread`, `post_message`, `add_reaction`).
  The gate/logic don't care — they live in `bridge.mjs`.
- **Config is the only per-user state** — `config.json` (git-ignored). Everything else is code.
- **Verify any change:** `cd scripts && node --test` (99 tests). `node scripts/bridge.mjs doctor`
  validates a config. Never commit `config.json`.

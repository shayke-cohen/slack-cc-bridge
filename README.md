# slack-cc-bridge

Drive Claude Code from a Slack self-DM. A message you type as **`@cc <task>`** spawns an
isolated, VS-Code-visible Claude Code session; replies in that thread continue the same
session; the session's progress (including turns you drive manually in VS Code) mirrors
back into the thread.

## How it's built

- **`SKILL.md`** — the orchestrator runbook. Running `/slack-cc-bridge` in a Claude Code
  session (ideally on **Haiku**) turns that session into the orchestrator: it owns all
  Slack I/O via the Webrix MCP and drives the loop.
- **`scripts/bridge.mjs`** (+ `lib/`) — dependency-free Node CLI for the deterministic
  plumbing: `classify` (self-only gate + `@cc` trigger + dedup), git worktrees,
  spawn/resume headless `claude`, transcript tailing, the thread↔session state map,
  and hardlinking sessions into the workspace list. 90 `node:test` tests.

Division of labor: **Slack = skill (needs the session-only MCP); everything else = the CLI.**

## Install

Skills are auto-discovered from `~/.claude/skills/`, so clone this repo there and seed a config:

```sh
git clone <this-repo> ~/.claude/skills/slack-cc-bridge
cp ~/.claude/skills/slack-cc-bridge/config.example.json ~/.claude/skills/slack-cc-bridge/config.json
```

No build step — `bridge.mjs` has zero dependencies. `config.json` is git-ignored (it holds
your Slack IDs + local paths); only `config.example.json` is tracked.

**Codex** uses the same skill format — clone into `~/.codex/skills/slack-cc-bridge/` (or symlink
the Claude copy: `ln -s ~/.claude/skills/slack-cc-bridge ~/.codex/skills/slack-cc-bridge`). It's
exposed as `/slack-cc-bridge` there via `user-invocable: true`. See **`AGENTS.md`** for the full
cross-agent install matrix and portability notes.

## Setup — instructions for the installing agent

`config.json` starts empty. Configure it for **this** user before the first run, then verify:

1. **Working directory.** Default `baseRepo` and `listWorkspace` to the git repo the user
   currently has open — `git -C <their-open-folder> rev-parse --show-toplevel`. `baseRepo` is
   where per-thread worktrees are cut from; `listWorkspace` is the folder whose VS Code Local
   list the sessions show up in (normally the same). Set `worktreeRoot` to
   `~/.claude/skills/slack-cc-bridge/data/worktrees` (git-ignored). Confirm with the user if unsure.
2. **Slack.** The skill needs a Slack MCP connected (it reads/posts via `mcp__…__slack__*`).
   Check one is available; if not, ask the user to connect it. Then set:
   - `author` = the user's Slack **member ID** (`U…`) — Slack → profile → ⋮ → **Copy member ID**.
   - `channel` = the DM to monitor (a notes-to-self self-DM is a `D…` id). Help the user get it —
     e.g. post a test message via the MCP and read it back, or have them copy the DM's channel id.
3. **Model / knobs.** `defaultModel`, `trigger`, cadence, caps — sensible defaults are in the
   example; change only if the user asks.
4. **Verify.**
   ```sh
   node ~/.claude/skills/slack-cc-bridge/scripts/bridge.mjs doctor   # config sanity checklist
   cd ~/.claude/skills/slack-cc-bridge/scripts && node --test        # 90 tests
   ```
   Then a live Slack round-trip: post a test message to `channel` and read it back via the MCP.

**Never commit `config.json`** — `.gitignore` already excludes it, keeping each user's IDs private.

## Run

```sh
/loop 45s /slack-cc-bridge        # poll every 45s; omit for a single tick
```

Then type `@cc <task>` in the monitored Slack self-DM. `@cc(sonnet) <task>` overrides the model.

## Config (`config.json`)

| key | meaning |
|---|---|
| `channel` / `channels` / `author` | monitored channel(s) — self-DM + any **private** channels you're in — and your Slack user id; the only source it acts on |
| `trigger` | new-session prefix (`@cc`) |
| `defaultModel` | model for spawned sessions (`claude-opus-4-8`) |
| `baseRepo` / `baseRef` | repo each per-thread worktree is cut from |
| `listWorkspace` | folder whose VS Code Local list the sessions are hardlinked into |
| `worktreeRoot` | where per-thread worktrees live |
| `pollSeconds` / `idlePollSeconds` | active vs idle poll cadence |
| `maxActiveSessions` | concurrency cap |
| `coalesceReplies` | merge rapid thread replies into one resume |
| `threadTtlHours` | idle age after which `prune` closes/drops a thread |

## Safety

Spawned sessions run with `--dangerously-skip-permissions`, so the bridge acts **only** on
messages from `author` in `channel` that aren't its own bot posts — enforced in the skill
**and** re-checked in the CLI (`guard`). This gate is non-negotiable.

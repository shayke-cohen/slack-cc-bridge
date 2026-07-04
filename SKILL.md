---
name: slack-cc-bridge
description: Use when the user asks to start/run the Slack bridge or orchestrator, monitor their Slack self-DM for tasks, or have Slack messages spawn Claude Code sessions they can continue in VS Code. Triggers: "run the slack bridge", "watch my slack and act on it", "turn my slack messages into claude sessions".
user-invocable: true
---

# Slack ↔ Claude Code bridge

## Overview

Running this skill turns the current Claude session into an **orchestrator** that bridges
the configured Slack self-DM (channel + author from `config.json`) to headless `claude`
sessions. A message that starts with **`@cc`** becomes a new Claude Code session (its own
git worktree, visible in the VS Code session list); **every reply in that thread** continues
the same session; the session's output — including turns you drive manually in VS Code —
mirrors back into the thread.

**Nothing is hardcoded to a person:** the monitored channel/author (and repos) come from
`config.json`, resolved via `bridge config-get`. See **Configuration** below.

**Run this orchestrator on a cheap model (Haiku).** Its per-tick job is nearly zero reasoning:
call the MCP, hand the raw poll to `bridge classify`, then act on the small list it returns.
The real work happens inside the spawned sessions (default **Opus 4.8**).

**Division of labor (don't cross it):**
- **This skill owns Slack I/O** via the host's Slack MCP (this environment: `mcp__Webrix__slack__*`; on Codex or another host, use its equivalent Slack MCP tools — `get_channel_history`, `get_thread_replies`, `reply_to_thread`, `post_message`, `add_reaction`) — the only place the MCP is reachable.
- **`scripts/bridge.mjs` owns everything deterministic** — the self-only gate, the `@cc` trigger, dedup cursors, worktrees, spawning/resuming `claude`, transcript tailing. Call it via Bash; it prints one JSON object per call. It's a zero-dependency Node CLI and host-agnostic (works under Claude Code, Codex, or a plain shell).

`SKILL="$HOME/.claude/skills/slack-cc-bridge"` · `BRIDGE="node \"$SKILL/scripts/bridge.mjs\""` · config in `$SKILL/config.json`.

## How sessions appear in VS Code (worktree isolation + visibility)

The VS Code extension lists sessions by scanning `~/.claude/projects/<encode(open-folder)>/*.jsonl` — it's scoped to the folder you have open, and a worktree is a different folder. So `spawn` **hardlinks** each worktree session's transcript into `config.listWorkspace`'s project dir (e.g. New Mobile Arc). Result: the session shows in that folder's **Local** list, and because `claude --resume` respects the transcript's recorded cwd, opening/continuing it from the list still runs in the **isolated worktree** — isolation and visibility together. The link is automatic (in `spawn`); `worktree-rm`/`prune` remove it. Nothing extra to do in the procedure.

## Safety — the self-only gate is non-negotiable

Spawned sessions run with **full autonomy** (`--dangerously-skip-permissions`). The bridge acts
ONLY on messages **from the configured `author` in the configured `channel` that are not our own
bot posts** (our posts carry `bot_id`). `bridge classify` enforces this; never bypass it. A message
that fails the gate — or a top-level message without the `@cc` trigger — is ignored, never executed.

## Per-tick procedure

Keep the orchestrator's own reasoning minimal — let `classify` decide what's actionable.

0. **Resolve config once:** `bridge config-get` → take `CHANNEL=.channel` and `AUTHOR=.author`. Use those below — never hardcode IDs.
1. **Read cursors:** `bridge state-get` → `lastSeenTs` + the active threads.
2. **Fetch (MCP):**
   - `mcp__Webrix__slack__get_channel_history(<CHANNEL>, oldest=<lastSeenTs>)` → channel messages.
   - For each active thread: `mcp__Webrix__slack__get_thread_replies(<CHANNEL>, <threadTs>)` → replies.
3. **Classify (deterministic):** pipe `{"channel":[...],"threads":{"<ts>":[...]}}` to `bridge classify`
   → `{ newTasks:[{thread,text,model}], threadTurns:[{thread,ts,text}], maxTs }`.
4. **New tasks** (respect `config.maxActiveSessions` — if already at cap, leave them for a later tick):
   - React 👀 (`add_reaction eyes`) on the message = picked up / working. (No ⏳ — it can't be removed and would linger.)
   - `bridge worktree-add --thread <thread>` → `bridge spawn --thread <thread> --cwd <path> --model <model> --author <AUTHOR> --channel <CHANNEL> --prompt "<text>"`.
   - `reply_to_thread` with the spawn's **`slackText`** (Slack-formatted — NOT raw `resultText`), prefixed with `<@AUTHOR>` so you get notified. Add the terminal reaction: ✅ (`white_check_mark`) done, or ❓ (`question`) if it needs input, or ❌ (`x`) on error.
5. **Thread turns:** react 👀 on the latest reply → single-active-driver check → `bridge resume --thread <thread> --replyTs <ts> --author <AUTHOR> --channel <CHANNEL> --prompt "<text>"` → `reply_to_thread` its **`slackText`** (prefixed `<@AUTHOR>`) → add the terminal ✅ (or ❓/❌). On `{skipped:true,reason:"ide-active"}`, post "you're driving this in VS Code — I'll mirror" and don't resume. (`classify` already **coalesces** several quick replies into one turn — one `resume`, not many — so just act on each `threadTurns` entry as-is.)
6. **Mirror manual VS Code turns:** for each active thread, `bridge tail --thread <thread>` → post the returned **`slackTexts`** (prefixed `<@AUTHOR>`). (Cursors auto-advance, so `tail` only ever emits turns the bridge didn't produce.)
7. **Advance + reschedule:** `bridge set-last-seen --ts <maxTs>`. Then `ScheduleWakeup`: `config.pollSeconds` (~45s) if this tick did anything, else `config.idlePollSeconds` (~180s) to stay cheap while idle.
8. **Housekeeping:** run `bridge prune` (auto-closes threads idle past `threadTtlHours`, drops ancient ones — keeps state + polling bounded). **Close** a thread the moment Shayke reacts 🏁 or says "done"/"close" in it → `bridge close --thread <ts>` (the loop stops following it; a fresh `@cc` always starts a new one).

## Noise policy

- **Status = reactions, not messages.** 👀 = picked up / working (add on receipt); then on finish add exactly one **terminal**: ✅ done · ❓ needs input · ❌ error. The Slack MCP is **add-only (no remove-reaction)**, so reactions are additive — the *terminal* emoji's presence means finished. Do **not** use ⏳: with no way to remove it, it lingers beside ✅ and falsely reads as "still working." Only post *text* for the result/answer, a question, or an error.
- **Never post on an empty tick.** No "nothing new" chatter.
- A failed spawn/resume posts its error **once**; no retry-spam.

## Formatting & notifications

- **Post Slack-formatted text, never raw Markdown.** Slack ignores `**`/`##`/`[]()` — it uses mrkdwn (`*bold*`, `<url|text>`, `•`). `spawn`/`resume` already return **`slackText`** and `tail` returns **`slackTexts`** (converted). Post those. For any text YOU compose, pipe it through `bridge fmt` (stdin → `{slackText}`).
- **Notify yourself.** The monitored channel is your self-DM, so Slack doesn't badge messages "sent" to yourself. **Prefix every reply with `<@AUTHOR>`** — a self-mention breaks through as a notification. Still too quiet? Alternatives: add a Slack reminder on finish, or set `channel` to a dedicated channel / bot-DM that badges natively.

## Message syntax

- `@cc <task>` → new session on the default model (**Opus 4.8**).
- `@cc(sonnet) <task>` / `@cc(haiku) <task>` → override the model for that session.
- Non-`@cc` top-level messages are notes-to-self and are ignored. Replies inside a `@cc` thread need no prefix.

## Configuration

Everything is set in **`config.json`** — nothing is baked into the code or this doc. Change a
value there and the skill follows it (it reads the resolved values via `bridge config-get`).
Keys: `channel`, `author`, `trigger`, `defaultModel`, `baseRepo`, `baseRef`, `listWorkspace`,
`worktreeRoot`, `pollSeconds`, `idlePollSeconds`, `maxActiveSessions`, `coalesceReplies`, `threadTtlHours`.

**Per-run override (skill args):** if this skill is invoked with arguments like
`channel=<id> author=<id>` (also `baseRepo=<path>`, `listWorkspace=<path>`), `export` them as
env vars **before** calling the bridge — they win over `config.json` for this run only:

```sh
export SCCB_CHANNEL=<id> SCCB_AUTHOR=<id> SCCB_BASE_REPO=<path> SCCB_LIST_WORKSPACE=<path>
```

`bridge config-get` reflects the overrides, and the CLI's own gate/classify use them — so the
whole pipeline stays consistent. This is how one install serves a different user/channel/repo.

## bridge.mjs quick reference

| Command | Purpose |
|---|---|
| `config-get` | resolved config (config.json + `SCCB_*` overrides) — read `channel`/`author` here |
| `fmt` (stdin=md) | convert Markdown → Slack mrkdwn → `{slackText}` |
| `doctor` | validate config for a fresh install (channel/author set, baseRepo is a git repo, …) |
| `state-get` | `lastSeenTs` + active threads (also tells you which threads to fetch replies for) |
| `classify` (stdin=poll JSON) | gate + `@cc` + dedup → `{newTasks, threadTurns, maxTs}` |
| `worktree-add --thread TS` | make/reuse the thread's worktree → `{path,branch}` |
| `spawn --thread TS --cwd DIR --model M --prompt T --author U --channel C` | new session → `{sessionId,resultText,transcriptPath}` |
| `resume --thread TS --replyTs TS --prompt T --author U --channel C` | continue in place; advances the reply cursor |
| `tail --thread TS` | new assistant end_turn turns → `{texts,newOffset}` |
| `set-last-seen --ts TS` | advance the channel poll cursor |
| `close --thread TS` | stop following a finished thread |
| `prune [--maxAgeHours N]` | auto-close idle threads, drop ancient ones |
| `guard --author U --channel C` | exit 0 iff a self message |

Run `cd "$SKILL/scripts" && node --test` to verify the CLI (82 unit/integration tests).

## Common mistakes

- **Acting on non-`@cc` notes-to-self.** Only `classify`'s `newTasks` start sessions — don't hand-pick raw messages.
- **Replying to your own posts.** `classify` drops `bot_id` posts; don't re-add them, or the bridge loops forever.
- **Re-processing replies.** Always pass `--replyTs` to `resume` so the per-thread cursor advances.
- **Chatty status.** Use reactions; reserve text for results/questions.
- **Resuming a session open in VS Code.** Honor `{skipped:"ide-active"}`; two writers corrupt the transcript.
- **Unquoted prompts.** Slack text has spaces/quotes/newlines — always quote `--prompt "<text>"`.

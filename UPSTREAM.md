# Contributions to getpaseo/paseo

What [@vecyang1](https://github.com/vecyang1) has sent upstream to [getpaseo/paseo](https://github.com/getpaseo/paseo), and the local fixes that run until upstream ships them. Generated 2026-11-11 21:31 from GitHub by `paseo_upstream_ledger.py`.

## Pull requests

| # | Title | State | Opened |
|---|---|---|---|
| [#9277](https://github.com/getpaseo/paseo/pull/9277) | fix(agent): preserve running agents across shutdown in restart recovery | open | 2026-11-10 |
| [#9032](https://github.com/getpaseo/paseo/pull/9032) | fix(antigravity): settle answered turns with stale trajectory errors without restarting driver | open | 2026-11-07 |

## Issues

| # | Title | State | Opened |
|---|---|---|---|
| [#9395](https://github.com/getpaseo/paseo/issues/9395) | bug(protocol,relay): failed tool_call null error freezes timeline validation & daemon status masks disconnected relay control | open | 2026-11-11 |
| [#9383](https://github.com/getpaseo/paseo/issues/9383) | bug(app): getCompactionMarkerLabel drops preTokens whenever trigger is manual or auto | open | 2026-11-11 |
| [#9355](https://github.com/getpaseo/paseo/issues/9355) | feat(antigravity-provider): bridge Antigravity ask_question & teamwork_interviewer to Paseo native question permission UI | open | 2026-11-11 |
| [#9312](https://github.com/getpaseo/paseo/issues/9312) | bug: [antigravity-provider] interrupt waits behind agy start, causing 'active run cancellation was not acknowledged' | open | 2026-11-10 |
| [#9082](https://github.com/getpaseo/paseo/issues/9082) | feat(speech): allow custom STT model IDs in SpeechProviderSheet & use toFile() instead of chunked fs.createReadStream in OpenAISTT | open | 2026-11-08 |

## Issues and pull requests joined

| # | Title | State | Opened |
|---|---|---|---|
| [#8782](https://github.com/getpaseo/paseo/issues/8782) | bug: <br> inside a Markdown table cell breaks the table row | open | 2026-11-04 |
| [#7649](https://github.com/getpaseo/paseo/pull/7649) | fix(antigravity): support slash commands and skill discovery | open | 2026-10-22 |
| [#7425](https://github.com/getpaseo/paseo/issues/7425) | bug: after one agy stream drop, every later Antigravity turn fails with the same "stream was interrupted" error, even when the reply completes | open | 2026-10-19 |

## Ideas started

| # | Title | Votes | Replies | Opened |
|---|---|---|---|---|
| [#9403](https://github.com/getpaseo/paseo/discussions/9403) | New Workspace: configurable shortcut to open "Choose the project" while typing | 1 | 0 | 2026-11-11 |
| [#9399](https://github.com/getpaseo/paseo/discussions/9399) | Command Center (Cmd+K): a workspace with one agent is listed twice, under Workspaces and under Agents | 1 | 0 | 2026-11-11 |
| [#9178](https://github.com/getpaseo/paseo/discussions/9178) | Clipboard copy: keep clean plain text in text/plain (no ** asterisks in Beeper/LinkedIn/WeChat) while preserving rich HTML in text/html for Notion | 3 | 0 | 2026-11-09 |
| [#9127](https://github.com/getpaseo/paseo/discussions/9127) | Dictation: option to insert the transcript without sending (Enter / Cmd+D currently send) | 1 | 0 | 2026-11-08 |
| [#9069](https://github.com/getpaseo/paseo/discussions/9069) | Command Center (Cmd+K) & Quick Switcher: Direct Project-level Workspace Jump + Left Sidebar Auto-Scroll | 1 | 0 | 2026-11-08 |
| [#9068](https://github.com/getpaseo/paseo/discussions/9068) | Schedules UI: Show execution history (Runs / All runs) and 1-click drill-down into completed run sessions | 1 | 0 | 2026-11-08 |
| [#9065](https://github.com/getpaseo/paseo/discussions/9065) | Drag & drop folders onto the Workspaces sidebar to open or create a workspace | 1 | 0 | 2026-11-08 |

## Discussions joined

| # | Title | Votes | Replies | Opened |
|---|---|---|---|---|
| [#6292](https://github.com/getpaseo/paseo/discussions/6292) | Workflow: more local speech models (including Chinese) and migration to new OpenAI audio APIs | 1 | 3 | 2026-10-07 |
| [#6123](https://github.com/getpaseo/paseo/discussions/6123) | File preview tab: open with default app / reveal in file manager | 2 | 1 | 2026-10-05 |
| [#5896](https://github.com/getpaseo/paseo/discussions/5896) | Add pdf preview? | 6 | 4 | 2026-10-02 |
| [#4636](https://github.com/getpaseo/paseo/discussions/4636) | [FR] Support setting hotkey for "Rename workspace" | 1 | 1 | 2026-09-10 |

## Running locally until upstream lands

| Local patch | What it changes | Upstream | Upstream state |
|---|---|---|---|
| `settle_answered_errors` | A turn whose final reply arrived is settled as completed instead of failing on a repeated, already-recovered agy stream error. | [#7425](https://github.com/getpaseo/paseo/issues/7425), [PR #9032](https://github.com/getpaseo/paseo/pull/9032) | #7425 open, #9032 open |
| `fast_close` | Closing an agy session stops the process after 250 ms, so a send after a plugin reload no longer times out. | [#8267](https://github.com/getpaseo/paseo/issues/8267) | #8267 open |
| `history_replay` | A resumed Antigravity session shows its earlier conversation. | [#8463](https://github.com/getpaseo/paseo/issues/8463), [PR #7004](https://github.com/getpaseo/paseo/pull/7004) | #8463 open, #7004 open |
| `slash_commands` | Antigravity sessions list and expand slash commands and skills. | [#7648](https://github.com/getpaseo/paseo/issues/7648) | #7648 closed |
| `lazy_resume / start_gate` | A daemon restart no longer starts one agy per restored session; starts are capped and each session gets its own request lane. | none filed | - |
| `startup_interrupt` | Interrupt during agy initialization bypasses serial request queue rather than failing with active run cancellation was not acknowledged. | [#9312](https://github.com/getpaseo/paseo/issues/9312) | #9312 open |

---
name: epic-board
description: Local board for multi-repository work (an "epic"): tasks from any tracker, steps, branches, merge requests, merge order, items that need a human decision, session plans and stage documents. Use it when work spans more than one repository or several tasks of one epic, when the user asks for the board, the epic status or "where are we", and when a session continues after compaction. Cursor session id is $EPIC_BOARD_SESSION_ID (also printed by the session-start hook); agent is cursor. Claude prints the session id from the session-start hook; agent is claude. Grok session id is $GROK_SESSION_ID; agent is grok.
---

# epic-board

CLI: `node "<plugin-root>/cli/epic.mjs" <command>` (below: `epic.mjs`). Full reference: `reference/cli.md`, data model: `reference/schema.md`, answer review: `reference/waiting.md`, stage documents: `reference/docs.md`. The board is local storage: it never calls a tracker; you write what you know into it.

The plugin root is the directory that contains `cli/` and `skills/`. This file is `skills/epic-board/SKILL.md`. Take the root from the absolute path you used to read this file and call that copy of the CLI. If `$CURSOR_PLUGIN_ROOT`, `$CLAUDE_PLUGIN_ROOT` or `$GROK_PLUGIN_ROOT` is set in the shell, that value is the root; those variables are set for hook processes and are often unset in the agent shell.

## Only the CLI

You read and write the board only through `epic.mjs`. The page and its HTTP API are for the user: do not fetch, open or call them with any tool, even when the user pastes a link, says "open", or the CLI fails. On a CLI error, read the message and `epic.mjs help`, fix the command, or tell the user.

A link is an address; turn it into CLI arguments (ids are URL-encoded):

| Link | Means | Start with |
|---|---|---|
| `<host>/` | all epics | `list` |
| `<host>/e/<epic>` | the epic | `show <epic>` |
| `<host>/e/<epic>#t-<task>` | task `<task>` | `show <epic> --json` |
| `<host>/e/<epic>#t-<task>/<step>` | step `<task>/<step>` | `show <epic> --json` |
| `<host>/api/epics/<epic>/…` | the epic | `show <epic>` |

An id from the link that is not in `show --json` is a question for the user. Pending items are listed in `show <epic>` (there is no `wait list`); `wait <epic> show <id> --json` gives one in full. When the user wants to look at the board, give them `epic.mjs url <epic>`.

## First run on a machine

`epic.mjs service status`. If the service is not installed, offer `epic.mjs service install` (it copies the app next to the data and registers a user service: launchd on macOS, systemd --user on Linux). Do not install without the user's yes. `epic.mjs doctor` shows tools and credentials as the service sees them.

## This session

- **Cursor.** Session id is `$EPIC_BOARD_SESSION_ID` (set by the session-start hook; the hook line may also name it). Agent is `cursor`. After compaction the hook does not re-inject the epic brief: before the first status or write, `show` the epic bound to this session id.
- **Claude.** The session-start hook prints the session id. Agent is `claude`. After compaction the hook prints the epic brief; follow that.
- **Grok.** Session id is `$GROK_SESSION_ID`. Agent is `grok`. After compaction the session-start note is not in the thread: before the first status or write, `list` and `show` the epic bound to this session id.

## Starting work

1. `epic.mjs list` — is there an epic already? An epic id is any short key: a tracker key (`PROJ-12`), a number, a slug.
2. If not: `epic.mjs new <id> --title … --goal … [--url <link to the epic in the tracker>]`, then `repo` for each repository (`--provider gitlab|github --project <host>/<owner>/<name>` when merge request facts are wanted), `task` for each task (`--url`, `--tracker`, `--role side` for side tasks).
3. `epic.mjs bind <epic> --session <session_id> --task <task> --agent <agent>` with the session id and agent from above.
4. Before any status report: `epic.mjs refresh <epic>`; take branch and MR facts only from the board.
5. Ask the user once where stage documents should live and record it: `docs-mode <epic> board` or `docs-mode <epic> linked`.

## When to write

Right after the event, one command:

| Event | Command |
|---|---|
| step started, finished, blocked | `step <epic> <task>/<step> --state … --note "<verified outcome>"` |
| branch created or pushed | `branch <epic> <task> <repo> <branch> --worktree … [--mr <number>]`, then `refresh --branch` |
| merge request opened | `branch … --mr <number>`, then `refresh --branch <repo>:<branch>` |
| task status changed in the tracker | `task <epic> <task> --status "<status>"` (records when it was checked) |
| decision made | `decide <epic> --task … --text … [--by <who>]` |
| a human has to decide or do something | `wait <epic> add <id> --title … --details "<what exactly, why, what to check>" --ref … --check "…"` |
| loose end noticed | `open-item <epic> <task> add "<text>"` |
| merge order known | `merge <epic> --set '[{"id":"m1","text":"…","branch":"repo:branch"}]'` |
| stage of work finished | `note <epic> --session <sid> --doing "…" --next "…"` |

A cross-task dependency is `--after <task>/<step>[,…] --label "<what is handed over>"`; order inside a task is sequential by itself.

## Needs decision

A pending item must be actionable without reading the chat:

- `--title` — the question or action in one line.
- `--details` — Markdown: what exactly to decide or do, why it blocks, the options and their cost.
- `--ref` (repeatable) — what it touches on the board: `task:<id>`, `step:<task>/<step>`, `branch:<repo>:<branch>`, `doc:<id>`, `decision:<id>`, `waiting:<id>`, or an `https://` link.
- `--input confirm|single|multi` — confirmation by default, one option or several options. Choice inputs need two or more stable `--option id=text` flags. `--recommend id` marks advice without selecting for the human.
- `--check` (repeatable) — conditions required to agree; separate from selectable options. A clarification does not check them.

The human agrees on the page, or sends the item back with a comment and no checklist. Either way it becomes `answered` and stays unresolved. A response with `clarification: true` is not an agreement. Review answers only when the user asks in chat (“Check agreed decisions”, `/review-answers`, `/epic-board:review-answers`), never on your own from a hook or a page submission; then follow `reference/waiting.md`. Never invent a human answer to close a request.

## Do not write

Retellings of the conversation, logs, guesses, unverified claims. Branch and MR facts are never typed by hand — only `refresh` writes them.

## Stage documents

Specs, plans, logs, reviews and notes attach to a task or step. Before any `doc` or `docs-mode` command, read `reference/docs.md`.

## Reports and export

- `report <epic> --task <id>` — a Markdown summary of a task to paste into its tracker. Posting it anywhere is the user's call.
- `export <epic> --out <file>.html` — one self-contained read-only HTML file to hand to a person.

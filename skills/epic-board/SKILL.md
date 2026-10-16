---
name: epic-board
description: Local board for multi-repository work (an "epic"): tasks from any tracker, steps, branches, merge requests, merge order, items that need a human decision, session plans and stage documents. Use it when work spans more than one repository or several tasks of one epic, when the user asks for the board, the epic status or "where are we", and after compaction if the hook named an epic.
---

# epic-board

CLI: `node "${CLAUDE_PLUGIN_ROOT}/cli/epic.mjs" <command>` (below: `epic.mjs`). Full reference: `reference/cli.md`, data model: `reference/schema.md`. The board is local storage: it never calls a tracker; you write what you know into it.

## First run on a machine

`epic.mjs service status`. If the service is not installed, offer `epic.mjs service install` (it copies the app next to the data and registers a user service: launchd on macOS, systemd --user on Linux). Do not install without the user's yes. `epic.mjs doctor` shows tools and credentials as the service sees them.

## Starting work

1. `epic.mjs list` — is there an epic already? An epic id is any short key: a tracker key (`PROJ-12`), a number, a slug.
2. If not: `epic.mjs new <id> --title … --goal … [--url <link to the epic in the tracker>]`, then `repo` for each repository (`--provider gitlab|github --project <host>/<owner>/<name>` when merge request facts are wanted), `task` for each task (`--url`, `--tracker`, `--role side` for side tasks).
3. `epic.mjs bind <epic> --session <session_id> --task <task> --agent claude` — the hook prints the session id at start.
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
- `--ref` (repeatable) — what it touches on the board: `task:<id>`, `step:<task>/<step>`, `branch:<repo>:<branch>`, `doc:<id>`, `decision:<id>`, or an `https://` link.
- `--check` (repeatable) — what must be true before it counts as done; the page will not accept "done" until every point is ticked.

The user confirms on the page. Mark it yourself only when the user told you it is done: `wait <epic> done <id> --checked c1,c2 --resolution "<what was decided>"`. `undo` reopens, `remove` deletes a mistaken item.

## Do not write

Retellings of the conversation, logs, guesses, unverified claims. Branch and MR facts are never typed by hand — only `refresh` writes them.

## Stage documents

Specs, plans, execution logs, reviews and notes show up on the board next to their task and step.

- Other tools decide where their own files go; do not change that. Let them write and link the file: `doc link <epic> <task>/<step> --kind spec|plan|log|review|note --title … --path <file>`. The file must live in a registered repository or worktree.
- `docs-mode board`: `doc new <epic> <task>/<step> --kind … --title …` prints a path; write the file there and keep editing it in place.
- `doc import` makes a one-off copy onto the board; `doc list`, `doc remove`.
- The user can edit a document on the page; re-read the file before your own edit.

## Reports and export

- `report <epic> --task <id>` — a Markdown summary of a task to paste into its tracker. Posting it anywhere is the user's call.
- `export <epic> --out <file>.html` — one self-contained read-only HTML file to hand to a person.

## The page

`epic.mjs url <epic>`. Open it in the built-in browser panel when the user wants to look.

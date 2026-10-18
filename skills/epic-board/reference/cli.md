# epic.mjs

`node "<plugin-root>/cli/epic.mjs" <command> …`, the same CLI the epic-board skill names (`cli/epic.mjs` beside `skills/`). Works on the data directly; the service is not needed. Errors go to stderr with exit code 1. `-` as a flag value clears the field (`--note -`, `--after -`, `--worktree -`, `--url -`). Every change accepts `--why "<reason>"`, which goes into the history. `epic.mjs help` prints the summary.

| Command | Example | What it does |
|---|---|---|
| `list` | `list` | epics and their pages |
| `new` | `new SHOP-1 --title Checkout --goal "One page" --url https://…` | create an epic |
| `repo` | `repo SHOP-1 web --path ~/src/web --base main --provider github --project github.com/acme/web` | describe a repository; `--provider gitlab` uses `glab`, `github` uses `gh` |
| `task` | `task SHOP-1 WEB-31 --title "Payment form" --url https://… --tracker Jira --status "In progress"` | a task with any id; `--status` also stamps when it was checked; `--role side` for side tasks |
| `step` | `step SHOP-1 WEB-31/wire --title Wire --state active --after API-12/endpoints --label schema --note "tests ok"` | a step; state: done, active, todo, blocked, waiting |
| `branch` | `branch SHOP-1 WEB-31 web feat/form --worktree ~/src/web-form --mr 412` | a task branch; `--delete` removes it |
| `open-item` | `open-item SHOP-1 WEB-31 add Rebase` / `open-item SHOP-1 WEB-31 done <oid>` | loose ends of a task |
| `wait` | `wait SHOP-1 add psp --kind decision --title "Pick a provider" --details "…" --task WEB-31 --ref step:WEB-31/wire --check "Fees compared"` | an item that needs a human; kind: decision, approval, review, action, other |
| `wait show` | `wait SHOP-1 show psp --json` | full question, current version and response/history |
| `wait submit` | `wait SHOP-1 submit psp --version V --submission-id S --confirmed --checked c1,c2 --comment "Checked fees"` | human agreement; single/multi use `--selected a,b`; every checklist id is required; remains pending agent review |
| `wait clarify` | `wait SHOP-1 clarify psp --version V --submission-id S --comment "Fee table is missing"` | human asks to change the question; comment required, checklist and options are not; remains pending agent review |
| `wait resolve` | `wait SHOP-1 resolve psp --version V --submission-id S --resolution "Provider A applied to the plan"` | agent accepts the current submitted response with an outcome |
| `wait revise` | `wait SHOP-1 revise psp --version V --reason "Fee structure changed" --title "Confirm revised provider"` | new revision, preserving question/answer history; optional request flags from add replace supplied fields |
| `wait remove` | `wait SHOP-1 remove mistaken --version V` | delete only open requests without response history |
| `decide` | `decide SHOP-1 --task WEB-31 --text "Cards first" [--by product]` | a decision, append-only |
| `merge` | `merge SHOP-1 --set '[{"id":"m1","text":"api","branch":"api:feat/x"}]'` | the merge order as a whole; a step may point at a pending item with `"waiting":"<id>"` |
| `bind` | `bind SHOP-1 --session <sid> --task WEB-31 --agent cursor` | bind a session; `--agent`: cursor, claude, grok, codex, gemini, … Session id: Cursor `$EPIC_BOARD_SESSION_ID`, Claude from the session-start hook, Grok `$GROK_SESSION_ID` |
| `note` | `note SHOP-1 --session <sid> --doing "…" --next "…"` | session plan |
| `refresh` | `refresh SHOP-1 [--task WEB-31 \| --branch web:feat/form]` | git facts, plus MR/PR facts for repos with a provider |
| `show` | `show SHOP-1 [--session <sid>] [--json]` | summary (≤ 25 lines) or JSON |
| `report` | `report SHOP-1 --task WEB-31` | Markdown summary of a task |
| `url` | `url SHOP-1` | page address |
| `doc` | `doc new SHOP-1 WEB-31/wire --kind plan --title Plan` · `doc link SHOP-1 WEB-31 --kind spec --title Spec --path ~/src/web/docs/spec.md` · `doc import …` · `doc list SHOP-1` · `doc remove SHOP-1 <id>` | stage documents: kept on the board or linked |
| `docs-mode` | `docs-mode SHOP-1 board` / `linked` | where the epic keeps documents |
| `export` | `export SHOP-1 [--out file.html]` | one read-only HTML file with styles, script, epic, documents and the last 200 history events |
| `doctor` | `doctor [--repo PATH]` | node, git, glab, gh, data dir, `git ls-remote`, forge auth per host |
| `service` | `service install` / `status` / `uninstall` | user service: launchd (macOS) or systemd --user (Linux) |

## Interactive requests

`wait add` accepts `--input confirm|single|multi` (default confirm), repeatable `--option id=text`, and `--recommend id`. Choice formats need at least two options; recommendation does not preselect an answer. `--ref waiting:<id>` links another request. `--check` remains a checklist required to agree, separate from selectable options. Clarification does not check it.

```sh
epic.mjs wait SHOP-1 add psp --title "Choose provider" --input single \
  --option a="Provider A" --option b="Provider B" --recommend a --check "Fees compared"
epic.mjs wait SHOP-1 show psp --json
```

Read the current version before every mutation; copy the current response's submissionId for resolve. Keep the same submissionId and payload when retrying a lost submit or clarify response. A new version after submit or clarify must be read before resolve/revise. `wait show` without `--json` also prints the full item. A clarification response has `clarification: true` and is not an agreement.

`revise` requires `--reason`, including reopening closed requests. Omitted request flags retain their values; supplied `--check` flags replace the entire checklist, and supplied `--option` flags replace all options. `--details -` and `--task -` clear those fields. `--option` without `--input` keeps the current format. `--input single|multi` alone keeps existing options; `--input confirm` removes inherited options. `--recommend id` alone changes the recommendation among current options. New supplied options replace old labels, hints and recommendation metadata.

Legacy `done` and `undo` fail with instructions to use resolve/revise. Human submission remains pending and does not grant permission for push, publication, merge or task completion. Review answers only after the user asks in chat; hooks and brief provide context without starting work automatically.

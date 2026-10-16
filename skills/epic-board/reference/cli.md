# epic.mjs

`node "${CLAUDE_PLUGIN_ROOT}/cli/epic.mjs" <command> …`. Works on the data directly; the service is not needed. Errors go to stderr with exit code 1. `-` as a flag value clears the field (`--note -`, `--after -`, `--worktree -`, `--url -`). Every change accepts `--why "<reason>"`, which goes into the history. `epic.mjs help` prints the summary.

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
| `wait done` | `wait SHOP-1 done psp --checked c1,c2 --resolution "Provider A"` | confirm; every checklist id must be listed. `undo` reopens, `remove` deletes |
| `decide` | `decide SHOP-1 --task WEB-31 --text "Cards first" [--by product]` | a decision, append-only |
| `merge` | `merge SHOP-1 --set '[{"id":"m1","text":"api","branch":"api:feat/x"}]'` | the merge order as a whole; a step may point at a pending item with `"waiting":"<id>"` |
| `bind` | `bind SHOP-1 --session <sid> --task WEB-31 --agent claude` | bind a session; `--agent`: claude, codex, grok, gemini, … |
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

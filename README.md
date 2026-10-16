# epic-board

[Русская версия](README.ru.md)

A local board for work that spans several repositories and several tasks at once — an *epic*. It keeps in one place what usually lives in chat scrollback and in your head: which task is at which step, which branch belongs to what, which merge request is green, what has to be merged first, and what is waiting for a human decision.

It ships as a [Claude Code](https://code.claude.com) plugin: the agent writes to the board as work happens and reads it back after a context compaction, so a long multi-repo task survives `/compact` and new sessions. You can use the board and its CLI without an agent too.

- **Any tracker.** Tasks have any id (`PROJ-12`, `#42`, `web-login`) and a link to wherever they live. The board never calls a tracker: it is storage you write to.
- **Facts from git, not from memory.** `refresh` runs `git fetch` once per repository and recounts every branch: head, distance from the base, unpushed commits, dirty worktree. With `glab` or `gh` it also reads merge request / pull request state and pipeline.
- **Needs decision.** Items that block on a person carry what exactly to decide or do, links to the tasks, steps, branches and documents involved, and an optional checklist that must be ticked before "Done" is accepted.
- **A map of the epic.** Tasks as cards with cross-task dependencies, the opened task as a strip of steps, the merge order and the goal.
- **Stage documents.** Specs, plans, logs and reviews next to their step: kept on the board or linked from a repository, viewable and editable on the page, with versions.
- **Session plans.** Each agent session records what it is doing and what comes next; the board shows Claude, Codex, Grok and Gemini sessions side by side.
- **Export.** One self-contained, read-only HTML file to hand to someone who has no board.
- **English and Russian** interface.
- **Local and dependency-free.** Node ≥ 22, no npm dependencies, listens on `127.0.0.1` only, data stays in your home directory.

## Install

### As a Claude Code plugin

```text
/plugin marketplace add k-semenko/epic-board
/plugin install epic-board@epic-board
```

Then ask the agent to install the epic-board service, or run it yourself from the newest plugin version:

```sh
node "$(ls -d ~/.claude/plugins/cache/epic-board/epic-board/*/ | sort -V | tail -1)cli/epic.mjs" service install
```

`service install` copies the app to `~/.local/share/epic-board/app`, keeps data in `~/.local/share/epic-board/data` and registers a user service (launchd on macOS, `systemd --user` on Linux). After a plugin update the session-start hook refreshes that copy and restarts the service by itself. The board opens at <http://localhost:4747>.

To stay on a release instead of following the default branch: `/plugin marketplace add k-semenko/epic-board#v0.5.0`.

### From source

```sh
git clone https://github.com/k-semenko/epic-board.git
cd epic-board
npm test
node cli/epic.mjs service install      # or: npm start, to run in the foreground
```

To load the plugin from the clone: `/plugin marketplace add /path/to/epic-board`.

### Try it without installing anything

```sh
npm run demo        # sample epic on a throwaway data dir: http://localhost:4799/e/SHOP-1
```

## Use

```sh
alias epic='node cli/epic.mjs'   # or the path inside the plugin cache
epic new SHOP-1 --title "One-page checkout" --goal "Customers pay on one page"
epic repo SHOP-1 web --path ~/src/web --base main --provider github --project github.com/acme/web
epic task SHOP-1 WEB-31 --title "Payment form" --url https://tracker.example.com/WEB-31 --status "In progress"
epic step SHOP-1 WEB-31/card --title "Card input" --state active
epic branch SHOP-1 WEB-31 web feat/payment-form --mr 412
epic wait SHOP-1 add psp --title "Pick the payment provider" --details "Compare fees and refunds" \
  --ref step:WEB-31/card --check "Fees compared" --check "Refund API checked"
epic refresh SHOP-1
epic url SHOP-1
```

`node cli/epic.mjs help` lists every command; [`skills/epic-board/reference/cli.md`](skills/epic-board/reference/cli.md) has examples and [`reference/schema.md`](skills/epic-board/reference/schema.md) the data model.

## Configuration

`~/.config/epic-board/config.json` (all keys optional):

| Key | Default | Meaning |
|---|---|---|
| `dataDir` | `~/.local/share/epic-board/data` | where epics, history and documents live |
| `port` | `4747` | service port |
| `host` | `localhost` | host name used in links; an extra allowed `Host` header, e.g. a name you mapped to `127.0.0.1` in `/etc/hosts` |
| `publicUrl` | — | address behind a reverse proxy, e.g. `http://board.example` without a port; links use it and its host is allowed |
| `stripProxy` | `false` | drop `HTTP(S)_PROXY` for git, glab and gh, for proxies that cannot reach your internal forge |

Environment overrides: `EPIC_BOARD_HOME` (data dir), `EPIC_BOARD_PORT`, `EPIC_BOARD_STRIP_PROXY=1`. `node cli/epic.mjs doctor` shows what the service sees: tools, credentials per forge host, `git ls-remote` of a registered repository.

## Security

The service binds to `127.0.0.1`, checks `Host` and `Origin` against DNS rebinding, serves documents only from the data dir and from repositories registered in an epic, and validates branch names before they reach git. It sends nothing anywhere except the `git`, `glab` and `gh` commands you configured. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## More

- [docs/architecture.md](docs/architecture.md) — how it is built
- [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), [docs/releasing.md](docs/releasing.md)
- License: [MIT](LICENSE); bundled libraries: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

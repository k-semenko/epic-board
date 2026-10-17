# Architecture

epic-board is three thin layers over one JSON file per epic.

```
cli/epic.mjs ─┐
hooks/*.mjs ──┼──> server/store.mjs ──> <data>/epics/<id>.json
server/http ──┘          │                <id>.history.ndjson
     │                   └─ refresh ──> git, glab, gh
     └─ server/page/*  (static page, no build step)
```

## Storage — `server/store.mjs`

- One file per epic, written atomically: temp file, `fsync`, rename.
- A per-epic lock file holds the owner's pid. A lock whose owner is dead is taken over; a slow live writer is waited for, never raced.
- Changes are JSON Merge Patches. Arrays merge by key (`tasks` by `id`, `branches` by `repo`+`name`, …), `$delete` removes an element, `null` removes a field. Every change appends before/after events to `<id>.history.ndjson`, which feeds the history list and per-step change logs.
- `validateEpic` runs on every write: ids, URLs, step references, branch names, references from pending items to board objects.
- `migrate` lifts schema 1 → 2 → 3 on read and persists it at the next write. Schema 1 had a numeric id, `stage`, `glab` and free-text pending items. Schema 3 adds versioned interactive requests and immutable rounds; legacy closures keep their original outcome without inventing a human response. Migrated item versions are deterministic until mutation.
- `facts` are written only by refresh, under the same lock; network work happens outside the lock.
- `server/waiting.mjs` validates confirm/single/multi requests and performs lifecycle transitions. Dedicated store actions submit, resolve, revise and remove check the current item version under the same lock. Submit saves an immutable request/response round and waits for agent review; only resolve sets doneAt. Replaying an identical submissionId/payload returns the current state even after review. Generic PATCH can create requests but cannot edit/delete existing requests or lifecycle fields. Checklist and option arrays are replaced whole on revision.

## Facts — `server/refresh.mjs`

- One `git fetch --prune origin` per shared Git directory, then a pool of four branch workers. Repository registration and healthy refreshes remember the primary checkout and common Git directory for use after a linked worktree is removed.
- Each worker reads head, behind/ahead against `origin/<base>`, unpushed commits against `origin/<branch>`, and worktree cleanliness.
- Repositories with a `provider` also ask `glab mr view` or `gh pr view` with an explicit `-R <host>/<project>`. That way the CLI never guesses the host from the service's working directory.
- Git and forge requests run independently. A failed source keeps its last successful facts and timestamp. Missing local Git produces a partial result while the MR still refreshes without a checkout; its comparison with the local head stays unknown.
- Progress streams as NDJSON (`POST /api/epics/<id>/refresh?stream=1`).

## HTTP — `server/http.mjs`

- Serves the page, the vendored `marked` and `DOMPurify`, and a JSON API.
- Endpoints: list, read, patch, history, rev, refresh, docs, export, waiting submit/resolve/revise/remove (POST `/api/epics/:epic/waiting/:id/:action`), selfcheck, health.
- Waiting mutations share the CLI store actions; malformed payloads return 400, stale tokens and invalid transitions return 409. Legacy done/undo return actionable errors.
- Every request must carry an allowed `Host`, as protection against DNS rebinding.
- `GET/PUT /api/settings` reads and atomically replaces the shared epic block order in `<data>/settings.json`, separately from epic data and history.
- A non-GET request must carry a matching `Origin` (when present) and `Content-Type: application/json`.

## Page — `server/page/`

- Plain ES modules with no bundler. `lanes.mjs` is the pure model of the map, shared with the tests; `app.js` renders.
- `waiting.mjs` renders requests, response/review history and read-only exports, and owns tab-local drafts keyed to the original version. Polling and language changes retain drafts; stale drafts require explicit review of the new question.
- `i18n.mjs` holds both dictionaries; the language follows the browser and can be switched on the page.
- The export (`server/export.mjs`) inlines CSS, the vendored libraries, the data and a bundle of the modules into one HTML file. In that file the page runs read-only.
- The header settings menu opens a block-order dialog. Changes stay in a draft until saved; section nodes move in the DOM so their content and controls stay intact. All epics use the same server setting, polled alongside epic revisions; exports carry a snapshot of it.

## Documents — `server/docs.mjs`

- A document is either owned (a file under `<data>/epics/<id>/docs/`) or linked (a `.md` file inside a registered repository or worktree).
- Paths are resolved through `realpath` and must stay inside those roots.
- Saving from the page checks `mtimeMs` and answers 409 if the file changed underneath. The previous text goes to `.versions/`.

## Service — `server/service.mjs`

- `service install` copies `server/`, `cli/` and `vendor/` to `~/.local/share/epic-board/app`. The copy is swapped in with a rename, so the service never sees half a tree.
- It writes a launchd agent (macOS) or a `systemd --user` unit (Linux) that pins the current `node` and the directories of `git`, `glab` and `gh` into `PATH`.
- It then waits for `/api/health`.
- The SessionStart hook compares the copy's version with the plugin's and reinstalls when they differ. A plugin update therefore reaches the running service without a manual step.

## Plugin

- `.claude-plugin/` holds the manifests, `skills/epic-board/` holds the instructions for the agent, `skills/review-answers/` the user-run answer review, and `hooks/` holds the hooks.
- `SessionStart` prints a short brief after compaction or resume, or a hint to bind the session inside a registered repository. It also syncs the service.
- `PreCompact` asks the summary to point at the board instead of retelling it.
- Answer review starts only after a user request in chat. Hooks and briefs display pending human/agent work and never launch review automatically.
- Hooks never fail a session: errors go to `<data>/hooks.log`.

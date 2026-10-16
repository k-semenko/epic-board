# Epic data model (schema 3)

One JSON file per epic in `<data>/epics/<id>.json`, plus `<id>.history.ndjson` (every change with before/after) and `<id>/docs/` for documents kept on the board. Schema 1 and 2 files migrate sequentially on read and are rewritten on the next change.

```json
{
  "schema": 3,
  "id": "SHOP-1",
  "title": "One-page checkout",
  "goal": "Customers pay on one page; the old checkout is switched off",
  "url": "https://tracker.example.com/browse/SHOP-1",
  "createdAt": "2026-10-16T09:00:00Z",
  "updatedAt": "2026-10-16T09:00:00Z",
  "repos": {
    "web": { "path": "/home/you/src/web", "base": "main", "provider": "gitlab", "project": "gitlab.com/acme/web" }
  },
  "tasks": [
    {
      "id": "WEB-31",
      "title": "[web] Payment form",
      "url": "https://tracker.example.com/browse/WEB-31",
      "tracker": "Jira",
      "role": "main",
      "status": "In progress",
      "statusCheckedAt": "2026-10-16T09:00:00Z",
      "steps": [
        { "id": "card", "title": "Card input", "state": "done", "note": "unit 120/0" },
        { "id": "wire", "title": "Wire the draft API", "state": "active", "after": ["WEB-31/card", "API-12/endpoints"], "label": "draft schema" }
      ],
      "branches": [
        { "repo": "web", "name": "feat/payment-form", "worktree": "/home/you/src/web-form", "mr": { "iid": 412 } }
      ],
      "open": [{ "id": "o1", "text": "Rebase on main after the API merge" }]
    }
  ],
  "waiting": [
    {
      "id": "psp", "kind": "decision", "title": "Pick the payment provider",
      "details": "Compare **fees** and the **refund API**; the form fields depend on it.",
      "task": "WEB-31", "refs": ["step:WEB-31/wire", "https://example.com/comparison"],
      "checklist": [{ "id": "c1", "text": "Fees compared" }, { "id": "c2", "text": "Refund API checked" }],
      "since": "2026-10-16T08:00:00Z",
      "input": { "type": "single", "options": [{ "id": "a", "text": "Provider A", "recommended": true }, { "id": "b", "text": "Provider B" }] },
      "status": "open", "revision": 1, "version": "opaque-server-token", "rounds": []
    }
  ],
  "mergeOrder": [
    { "id": "m1", "text": "api", "branch": "api:feat/draft-orders" },
    { "id": "m2", "text": "Migration on staging", "waiting": "migration" }
  ],
  "decisions": [{ "id": "d1", "at": "2026-10-16T08:00:00Z", "task": "WEB-31", "text": "Cards first", "by": "product" }],
  "sessions": [{ "id": "<session id>", "agent": "claude", "task": "WEB-31", "startedAt": "…", "lastAt": "…", "doing": "…", "next": "…" }],
  "docsMode": "linked",
  "docs": [{ "id": "…", "task": "WEB-31", "step": "wire", "kind": "plan", "title": "Wiring plan", "path": "…", "owned": true }],
  "facts": {
    "web:feat/payment-form": {
      "fetchedAt": "…", "head": "eaf756ec85", "subject": "…",
      "behind": 12, "ahead": 5, "unpushed": 2, "remoteBehind": 0, "dirty": false, "worktreeExists": true,
      "mr": { "state": "opened", "draft": false, "sha": "eaf756ec85…", "pipeline": "success", "shaMatchesHead": true, "url": "…", "fetchedAt": "…" },
      "error": null
    }
  }
}
```

Rules:

- Ids of epics and tasks: letters, digits, `.`, `_`, `-`, up to 64 characters, not starting with `.` or `-`. Step ids: letters, digits, `.`, `_`, `-`.
- `url` fields are `http(s)://` only.
- `role`: `main` leads to the goal; `side` is shown off the chain.
- `steps[].state`: `done | active | todo | blocked | waiting`. `active` means "we are here".
- `steps[].after`: references `<task>/<step>`. Without `after` a step follows the previous step of its task; write `after` only for cross-task links and forks.
- `repos[].provider`: `gitlab` (asks `glab mr view`) or `github` (asks `gh pr view`); `project` is `<host>/<owner>/<name>` so the CLI never guesses the host. Without a provider a branch gets git facts only.
- `waiting[].kind`: `decision | approval | review | action | other`. `refs` support `task:`, `step:`, `branch:`, `doc:`, `decision:`, `waiting:<id>` and `http(s)` links.
- `input.type`: `confirm` (default), `single` (exactly one selection), `multi` (at least one selection). Choice inputs require at least two options with unique stable IDs and nonempty text; `hint` and `recommended` are optional. A recommendation does not select anything. Every checklist ID must be checked for all input types.
- `status`: `open` waits for a human; `answered` waits for agent review requested in chat; `closed` has an agent outcome. `doneAt` and `resolution` exist only after closure. Both open and answered items block dependencies.
- `revision` starts at 1; revision 2 and later require a nonempty `revisionReason`. `version` is an opaque token checked under the epic lock and changed on each mutation. Read it immediately before acting.
- Each immutable `rounds[]` entry contains `{revision, version, request, response, review?}`. `request` snapshots `title`, `details`, `kind`, `task`, `refs`, `input`, `checklist`, `revisionReason` when present. `response` contains `submissionId`, `at`, `by`, explicit `confirmed`, `selected`, `checked`, optional `comment`. `review` is written once with `outcome: accepted|revised`, `at`, `by`, `text`.
- Revision archives an answered round with outcome `revised`; reopening a closed item preserves its existing `accepted` review. New revisions start open without a response. The existing checklist and input arrays are retained unless explicitly replaced.
- Legacy closed items preserve their prior `doneAt`, `checked`, `resolution` and question in `legacyClosure`; no human response is invented. Migrated tokens are deterministic from the epic ID and original item until the first mutation.
- A branch in `facts` is keyed `<repo>:<branch>`. git runs in `branches[].worktree` when it exists, else in `repos[repo].path`.
- `facts` is written by refresh only; a PATCH with `facts` is rejected (400).

**PATCH rules** (body `{patch, by, why}`): JSON Merge Patch for objects (`null` removes a field); arrays merge by key:

| Array | Key | Removal |
|---|---|---|
| `tasks` | `id` | `{"id": …, "$delete": true}` |
| `tasks[].steps` | `id` | same |
| `tasks[].branches` | `repo` + `name` | `{"repo", "name", "$delete": true}` |
| `tasks[].open` | `id` | `$delete` |
| `waiting` | `id` | creation only; use dedicated versioned actions to change/remove existing items |
| `decisions` | `id` (assigned by the server) | append only |
| `sessions` | `id` | `$delete` |
| `docs` | `id` | through `doc remove` |
| `mergeOrder`, `refs`, `after`, `waiting[].checklist`, `input.options` | — | replaced whole; waiting request changes use `revise` |

- `after` pointing at a missing step is 400.
- Branch names are validated before they reach git; `repo` must exist in `repos`.

## Waiting lifecycle API

POST `/api/epics/:epic/waiting/:id/<action>` with JSON:

| Action | Body |
|---|---|
| `submit` | `{version, submissionId, confirmed?, selected?, checked?, comment?}`; confirm requires `confirmed:true`; selection/checklist IDs are arrays |
| `resolve` | `{version, submissionId, resolution}`; current answered round and nonempty outcome required |
| `revise` | `{version, reason, patch?}`; patch contains request fields only; omitted patch retains the question |
| `remove` | `{version}`; only open items with no rounds |

A submit with the same submissionId and identical content replays the saved response and current state, including after review. A reused ID with different content conflicts. Stale versions and competing transitions return 409 without writing. Malformed input returns 400. `done` and `undo` return actionable errors directing callers to `resolve` and `revise`.

Generic PATCH cannot write/remove lifecycle fields (`status`, `version`, `revision`, `revisionReason`, `rounds`, `legacyClosure`, `doneAt`, `resolution`) or alter/delete existing requests through array/null replacement. It may create a new request with server-generated lifecycle fields. Use `revise` for request fields and `remove` for an unsubmitted mistaken request. Human submission never closes an item or starts an agent.

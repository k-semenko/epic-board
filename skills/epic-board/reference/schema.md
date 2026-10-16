# Epic data model (schema 2)

One JSON file per epic in `<data>/epics/<id>.json`, plus `<id>.history.ndjson` (every change with before/after) and `<id>/docs/` for documents kept on the board. Schema 1 files are migrated on read and rewritten on the next change.

```json
{
  "schema": 2,
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
      "doneAt": "2026-10-16T10:00:00Z", "checked": ["c1", "c2"], "resolution": "Provider A"
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
- `waiting[].kind`: `decision | approval | review | action | other`. `refs` must point at things on the board or be `http(s)` links. Done items stay with `doneAt`, `checked` and `resolution`; done requires every checklist id.
- A branch in `facts` is keyed `<repo>:<branch>`. git runs in `branches[].worktree` when it exists, else in `repos[repo].path`.
- `facts` is written by refresh only; a PATCH with `facts` is rejected (400).

**PATCH rules** (body `{patch, by, why}`): JSON Merge Patch for objects (`null` removes a field); arrays merge by key:

| Array | Key | Removal |
|---|---|---|
| `tasks` | `id` | `{"id": …, "$delete": true}` |
| `tasks[].steps` | `id` | same |
| `tasks[].branches` | `repo` + `name` | `{"repo", "name", "$delete": true}` |
| `tasks[].open` | `id` | `$delete` |
| `waiting` | `id` | `$delete` |
| `waiting[].checklist` | `id` | `$delete` |
| `decisions` | `id` (assigned by the server) | append only |
| `sessions` | `id` | `$delete` |
| `docs` | `id` | through `doc remove` |
| `mergeOrder`, `refs`, `after` | — | replaced whole |

- `after` pointing at a missing step is 400.
- Branch names are validated before they reach git; `repo` must exist in `repos`.

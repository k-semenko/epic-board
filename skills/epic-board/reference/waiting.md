# Reviewing answers to pending items

Read this only when the user asks in chat to review answers, for example “Check agreed decisions”, or runs `/review-answers` or `/epic-board:review-answers`. The human submits an answer on the page; the item becomes `answered` and stays unresolved until you review it. SessionStart, PreCompact and brief are informational: never start or schedule review from a page submission or a hook.

## Finding answered items

`show <epic>` lists pending items; answered ones read `waiting for agent` (`"status": "answered"` in `show <epic> --json`). There is no `wait list`.

## Reviewing one item

1. Read `wait <epic> show <id> --json`; inspect the current question, version and latest round response (including selected option labels, checklist and comment). Re-read relevant task/branch context. A response with `clarification: true` is a request to change the question, not an agreement: `confirmed` is false and the checklist is empty. Revise the question when the comment leaves it unclear, or resolve with the outcome when the comment is enough to act.
2. If the answer is sufficient, record how it was used: `wait <epic> resolve <id> --resolution "<concrete outcome>"`. Add `--version` and `--submission-id` to guard against a newer answer arriving meanwhile.
3. If clarification is required, use `wait <epic> revise <id> --version <current-version> --reason "<what needs clarification and why>" [request flags from add]`. This creates an open revision and preserves past answers. Reopening a closed item also uses revise with a reason.
4. For a separate question, create a new ID with `--ref waiting:<original-id>`; resolve the original separately when appropriate.

## Versions and mutations

Submit, clarify, revise and remove require the current version; resolve checks it only when given. On conflict, read again and assess the new state before acting. `wait submit` records a human answer only when explicitly authorized; use `--confirmed` for confirm or `--selected a,b` for choices, plus all `--checked` IDs, a stable `--submission-id` and optional `--comment`. Retrying a lost response uses the same ID and payload. Never invent a human answer; when the human agreed in chat, resolve the item directly instead.

Supplied checklist/option flags in revise replace their entire arrays. `wait remove <id> --version <current-version>` deletes only open requests with no submitted history. Legacy `done`/`undo` direct callers to resolve/revise. Closing a request does not complete its task or grant permission for push, publication or merge. The separate `decide` journal is updated only when needed; responses are not duplicated automatically.

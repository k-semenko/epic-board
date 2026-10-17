# Stage documents

Specs, plans, execution logs, reviews and notes show up on the board next to their task and step. Where an epic keeps them is set once per epic: `docs-mode <epic> board` or `docs-mode <epic> linked`.

- Other tools decide where their own files go; do not change that. Let them write and link the file: `doc link <epic> <task>/<step> --kind spec|plan|log|review|note --title … --path <file>`. The file must live in a registered repository or worktree.
- `docs-mode board`: `doc new <epic> <task>/<step> --kind … --title …` prints a path; write the file there and keep editing it in place.
- `doc import` makes a one-off copy onto the board; `doc list`, `doc remove`.
- The user can edit a document on the page; re-read the file before your own edit.

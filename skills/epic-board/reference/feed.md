# Feed connectors

Connectors push items with `epic.mjs feed add <file|->`. The board never polls sources and never stores their tokens.

## Item (contract v0)

Required: `source`, `externalId`, `kind`, `severity`, `title`.

- `kind`: `mention | alert | question | report | info`
- `severity`: `fire | important | normal | noise`
- `refs`: full addresses only — `epic:<id>`, `task:<epic>/<task>`, `step:<epic>/<task>/<step>`, `waiting:<epic>/<id>`, or `http(s)://…`
- Unknown board objects are dropped with `warnings[]`; bad ref format is rejected
- Secrets (tokens, private keys) in title/body/channel are rejected

Upsert key is `source` + `externalId`. Repeats bump `count`; content changes on a marked item set `changedSinceMark`.

## Commands

```sh
epic.mjs feed add items.json
epic.mjs feed list --unmarked --json
epic.mjs feed mark <id…> important|unimportant|noise [--comment …]
epic.mjs feed summary --json
epic.mjs feed profile --source my-source --json
epic.mjs feed profile show --source my-source
epic.mjs feed prune
```

Agents must not mark items for the human. Read `feed profile show` before selecting what to push.

## Retention

Configured under Settings → Feed (`feed.retention.*`). Prune runs on service start, hourly, on `feed prune`, and opportunistically during `feed add`.

---
name: review-answers
description: Review answers a human submitted on the epic board for pending items, then resolve or revise each one. Run by the user only.
argument-hint: "[epic id or board link]"
disable-model-invocation: true
---

# Review answers on the board

Epic: the id or board link in the user's message (`$ARGUMENTS` when the host expands it). In Codex, invoke explicitly as `$epic-board:review-answers <epic id or board link>`.

The board rules live in the sibling skill. This file is `skills/review-answers/SKILL.md`; read `../epic-board/SKILL.md` (from this file's directory) first if it is not loaded. Work only through the CLI that skill names. A board link is turned into an epic id as that skill describes.

1. Epic from the user's message or expanded `$ARGUMENTS` when they passed one. Otherwise the epic bound to this session: `$CODEX_THREAD_ID` in Codex, `$EPIC_BOARD_SESSION_ID` or the session-start hook line in Cursor, the session-start hook line in Claude, `$GROK_SESSION_ID` in Grok. Use `list` and `show` to find that binding. If none names an epic, ask.
2. Follow `../epic-board/reference/waiting.md` (from this file's directory) for every answered item (`waiting for agent` in `show`).
3. Report one line per item: id, the answer, resolved or revised and why. Nothing answered — say so and stop.

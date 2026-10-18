---
name: review-answers
description: Review answers a human submitted on the epic board for pending items, then resolve or revise each one. Run by the user only.
argument-hint: "[epic id or board link]"
disable-model-invocation: true
---

# Review answers on the board

Epic: $ARGUMENTS

The board rules live in the sibling skill. This file is `skills/review-answers/SKILL.md`; read `../epic-board/SKILL.md` (from this file's directory) first if it is not loaded. Work only through the CLI that skill names. A board link is turned into an epic id as that skill describes.

1. Epic from `$ARGUMENTS` when the user passed one. Otherwise the epic bound to this session: `$GROK_SESSION_ID` in Grok, the session-start hook line in Claude. If neither names an epic, run `list` and ask.
2. Follow `../epic-board/reference/waiting.md` (from this file's directory) for every answered item (`waiting for agent` in `show`).
3. Report one line per item: id, the answer, resolved or revised and why. Nothing answered — say so and stop.

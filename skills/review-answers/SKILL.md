---
name: review-answers
description: Review answers a human submitted on the epic board for pending items, then resolve or revise each one. Run by the user only.
argument-hint: "[epic id or board link]"
disable-model-invocation: true
---

# Review answers on the board

Epic: $ARGUMENTS

The board rules live in the `epic-board` skill: read `${CLAUDE_PLUGIN_ROOT}/skills/epic-board/SKILL.md` first if it is not loaded. Work only through `node "${CLAUDE_PLUGIN_ROOT}/cli/epic.mjs"`; a board link is turned into an epic id as that skill describes.

1. No epic given: take the one bound to this session from the hook output, otherwise run `list` and ask.
2. Follow `${CLAUDE_PLUGIN_ROOT}/skills/epic-board/reference/waiting.md` for every answered item (`waiting for agent` in `show`).
3. Report one line per item: id, the answer, resolved or revised and why. Nothing answered — say so and stop.

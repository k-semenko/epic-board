# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.0] - 2026-10-20

### Added

- The service plays one sound per feed batch at its most severe unseen item and can show a system banner, whichever connector wrote the items; connectors only set `severity`.
- Settings → Notifications: on/off, minimum level, a sound per level with preview, volume, banner and quiet hours.
- Eleven generated board sounds (quiet, noticeable and loud) alongside the macOS system sounds; `scripts/sounds/generate.mjs` rebuilds them.
- Settings support string patterns, select, sound, range and quiet-hours controls.
- The settings page shows each setting as a row with its control on the right; explanations and defaults moved behind a `?` hint.
- Notifications are off by default and start at 10% volume.

### Fixed

- Saving from the settings page sent an unserialized body and failed.

## [0.11.0] - 2026-10-19

### Added

- Settings registry with schema 2, revision checks, `/settings`, and `config` CLI; legacy settings keys still accepted on write.
- Signal feed with CLI/API, retention settings, profiles, `/feed` triage UI, header badge, server-side global search, and a home dashboard strip.
- Feed connector contract v0 (`schemas/feed-item.v0.json`, `skills/epic-board/reference/feed.md`) and anonymized connector examples.
- Feed items are cards with severity, source, channel and creation time, a clamped preview and a full-text dialog; the feed groups by source or severity.
- The feed's *How to use* dialog explains triage to people and gives agents the prompt and CLI interface.
- `feed list` filters by `--severity` and `--mark`.
- The session-start hook warns when the plugin is older than the installed service copy and names the update commands for the agent.

### Fixed

- A feed mark batch with an unknown id is rejected before any item or profile counter changes.
- Board search returns highlight ranges, opens tasks, steps and loose ends on the epic map, finds settings by their translated labels and works from every page.
- A disagreeing mark asks *why?* before the item leaves the list, keyboard focus follows the drawn order, and undo restores a previous mark.
- The dashboard strip is drawn on the home page and counts merge requests from refreshed facts.
- Settings controls, header icons and feed filters follow the board's styles; defaults read as text instead of JSON.

## [0.10.0] - 2026-10-18

### Added

- Informational links between steps in different epics, with current counterpart states, backlinks and related epics on the home page.
- Link snapshots in task reports and standalone HTML exports, including missing-target and incomplete-data notices.
- Delete tasks and steps from the CLI with reference checks and an explicit `--cleanup-refs` option that preserves documents and immutable history.

### Fixed

- Keep external links intact when deleting a local task with the same ID as a foreign epic, and preserve focused controls and drafts during link updates.

## [0.9.0] - 2026-10-18

### Added

- Pin epics into a separate section at the top of the home page, with pins saved in shared board settings.

### Changed

- Show two epic cards per row on wide screens and one on narrow screens. Cards share the same height, with a single-line title, a two-line goal and ellipses for overflow.

### Fixed

- Clear obsolete push warnings when both local and remote branches are removed, while retaining the dated Git snapshot and refreshing linked merge requests.

## [0.8.0] - 2026-10-18

### Added

- Codex plugin manifest, local marketplace and SessionStart hook that restores the epic brief on resume and after compaction.
- Codex skill metadata, with `$epic-board:review-answers` restricted to explicit invocation.

### Changed

- Skills cover Codex session binding with `$CODEX_THREAD_ID` and `--agent codex`.
- Codex examples use fully qualified plugin skill names.

## [0.7.0] - 2026-10-18

### Added

- Cursor plugin manifests (`.cursor-plugin/`) and hooks that inject board context on session start. Cursor sets `$EPIC_BOARD_SESSION_ID` from `sessionStart`.

### Changed

- Skills also cover Cursor: bind with `$EPIC_BOARD_SESSION_ID` / the session-start hook and `--agent cursor`. After compaction, re-`show` the bound epic (Cursor does not re-inject the brief).

## [0.6.2] - 2026-10-18

### Changed

- Skills resolve the CLI from the plugin directory that contains them. A Grok session binds with `$GROK_SESSION_ID` and `--agent grok`.
- Ignore macOS `.DS_Store` files in every directory.

## [0.6.1] - 2026-10-18

### Added

- Send a pending item back for clarification from its card. The comment stays visible, and agreement still requires the checklist.

### Fixed

- Keep neighboring task cards one gap apart when their steps depend on each other. A collapsed cycle no longer stretches the first arrow across empty columns.
- Do not draw a task arrow back to the previous card when a later step waits on the next task. That link stays on the opened task.

### Changed

- Highlight the arrows and cards linked to the selected task, and widen the gap so the link label fits between the cards.
- Draw a jump across several cards as a smooth curve instead of a square corner. A short hop is one arch, with no flat top.

## [0.6.0] - 2026-10-17

### Added

- Independent pagination for waiting items, decisions and history, with shared 5/10/15 page-size settings saved across restarts and included in exports.
- Shared epic page block order, configured from the header with drag and drop or keyboard controls and preserved in HTML exports.
- `/epic-board:review-answers`, a user-run skill that reviews answers submitted on the page and resolves or revises each item.

### Changed

- Scroll the chain to the active card from its own button beside the scale, and save the map height as S (one card), M (400px), or L (the screen under the header).
- Keep the off-chain column fixed. Only the task chain on the left scrolls.
- Draw overview task cards larger, and place the info button in the top-right corner at the same size as the status chip.
- Remove the map line that named the active step, including the empty "No active steps" state.
- Show the whole task chain at full strength in the overview. 100% is a card at its drawn size, and the chain scrolls inside the block.
- Scroll the step strip so the open step sits in the middle. The first and last steps stay at the ends of the strip.
- Widen the page column to 1300px. The header uses the same limit.
- Name the board EpicBoard in the header and the document title, and ship a light and dark favicon with matching theme-color.
- Open an epic from anywhere on its card. The title is no longer the only hit target.
- Keep agents on the CLI when the user pastes a board link: the skill maps page links to epic, task and step ids and leaves the page and its API to the user.
- Move answer review and stage-document rules from the main skill into `reference/waiting.md` and `reference/docs.md`.
- Keep the task chain at a fixed height that shows one row of cards, so the block stays put. With a side column the block is 400px and does not shrink.
- Show the selected card with an inner accent edge and dim the other cards. An outer ring was clipped to the corners.
- Drag the task chain by hand the same way as the step strip. A short press still opens the task.
- Keep the task chain where it was scrolled when a task is opened, and zoom that chain with Ctrl or Command and the wheel. A corner control shows the scale and resets it to 100%.
- Stop treating commits ahead of the base as unpushed when the remote branch is absent, including branches deleted after squash merge.
- Keep repository root and common Git paths so refresh survives deleted worktrees; refresh merge requests independently and distinguish current MR state from unavailable local Git data.
- Show editable Markdown markers in the active document block and render formatting when the cursor moves away.
- Remove the focus outline around the visual document surface while keeping focus indicators on editor controls.
- Give off-chain tasks the same step-panel header as tasks in the main chain.
- Open documents in one visual Markdown editor with formatting tools, undo and preserved drafts on save conflicts; isolate editor styles from the board.
- Move task dependencies and follow-up links into the step preview, and give step cards more room for their titles by removing subtitles.
- Remove the redundant document count from the step preview.
- Align the task number, title, status and tracker link on the same text baseline.
- Show off-chain tasks as separate cards at the end of the overview, without arrows, with access to their steps and documents.
- Group off-chain tasks into an animated card carousel with wheel, keyboard and button navigation, keeping its height fixed and remembering the front card.
- Keep map cards below the sticky header and make its background opaque while scrolling.
- Browse off-chain cards without changing the opened task or step; select a task only when its card is activated.
- Reserve horizontal scrollbar space in the step timeline to keep the document and preview panels from shifting between tasks.
- Open document viewing, editing and creation below the header without changing page spacing or hiding the page scrollbar.
- Collapse waiting items to their title, status and action type by default; keep drafts while paging and reveal search results on their page.

## [0.5.1] - 2026-10-16

### Added

- `publicUrl` in the config: the board can sit behind a reverse proxy on a plain address without a port.

### Changed

- `setup-runner.sh` stops early when dpkg has unfinished packages.

## [0.5.0] - 2026-10-16

First public release.

### Added

- Local dashboard for multi-repository work grouped into epics, plus a Claude Code plugin with a skill and hooks.
- Tasks with steps, branches, decisions and session plans per epic.
- MR/PR facts read from local git, with optional `glab` or `gh` integration.
- Stage documents attached to an epic.
- Single-file HTML export of an epic.
- Background service bound to `127.0.0.1`: launchd on macOS, `systemd --user` on Linux.
- No runtime dependencies (Node.js 22+); vendored marked and DOMPurify for Markdown rendering.
- All data stays on the user's machine.

### Changed

- Tasks are tracker-agnostic: any id plus an optional URL to any tracker.
- "Waiting for you" became "Needs decision", with details, linked items and an optional confirmation checklist.
- The UI is bilingual (English and Russian).
- Linux support via `systemd --user`.

[Unreleased]: https://github.com/k-semenko/epic-board/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/k-semenko/epic-board/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/k-semenko/epic-board/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/k-semenko/epic-board/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/k-semenko/epic-board/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/k-semenko/epic-board/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/k-semenko/epic-board/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/k-semenko/epic-board/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/k-semenko/epic-board/releases/tag/v0.5.0

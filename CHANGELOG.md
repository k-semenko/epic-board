# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Independent pagination for waiting items, decisions and history, with shared 5/10/15 page-size settings saved across restarts and included in exports.
- Shared epic page block order, configured from the header with drag and drop or keyboard controls and preserved in HTML exports.

### Changed

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

[Unreleased]: https://github.com/k-semenko/epic-board/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/k-semenko/epic-board/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/k-semenko/epic-board/releases/tag/v0.5.0

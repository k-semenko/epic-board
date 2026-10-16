# Third-party notices

epic-board ships the following third-party code in `vendor/`. The original libraries retain their license headers; editor dependency licenses are included alongside the assets. Versions are also recorded in `vendor/VERSION`.

| Component | Version | Path | License | Upstream |
|---|---|---|---|---|
| marked | 15.0.12 | `vendor/marked.min.js` | MIT | https://github.com/markedjs/marked |
| DOMPurify | 3.2.6 | `vendor/purify.min.js` | Apache-2.0 OR MPL-2.0 | https://github.com/cure53/DOMPurify |
| Vditor | 4.0.0 | `vendor/vditor*.js`, `vendor/vditor.css` | MIT | https://github.com/Vanessa219/vditor |
| Lute | Bundled with Vditor 4.0.0 | `vendor/vditor-lute.min.js` | MulanPSL-2.0 | https://github.com/88250/lute |
| diff-match-patch | 1.0.5 | Included in `vendor/vditor.min.js` | Apache-2.0 | https://github.com/google/diff-match-patch |

## marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Licensed under the MIT License. Full text: https://github.com/markedjs/marked/blob/v15.0.12/LICENSE.md

## DOMPurify

Copyright (c) Cure53 and other contributors.

Dual-licensed under the Apache License 2.0 and the Mozilla Public License 2.0; epic-board uses it under the Apache License 2.0. Full text: https://github.com/cure53/DOMPurify/blob/3.2.6/LICENSE

## Document editor

Vditor is licensed under MIT (`vendor/vditor.LICENSE.txt`). Its Lute Markdown engine uses MulanPSL-2.0 (`vendor/vditor-lute.LICENSE.txt`), and its diff-match-patch dependency uses Apache-2.0 (`vendor/vditor-diff-match-patch.LICENSE.txt`).

The editor integration source, pinned build dependencies and lockfile are in `scripts/vendor/`. Rebuild with `node scripts/vendor/build.mjs`; dependencies are installed in a temporary directory and are not needed to run epic-board.

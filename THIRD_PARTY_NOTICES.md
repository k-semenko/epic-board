# Third-party notices

epic-board ships the following third-party code in `vendor/`. The original libraries retain their license headers; the editor bundle includes a separate file with all bundled license texts. Versions are also recorded in `vendor/VERSION`.

| Component | Version | Path | License | Upstream |
|---|---|---|---|---|
| marked | 15.0.12 | `vendor/marked.min.js` | MIT | https://github.com/markedjs/marked |
| DOMPurify | 3.2.6 | `vendor/purify.min.js` | Apache-2.0 OR MPL-2.0 | https://github.com/cure53/DOMPurify |
| Milkdown with GFM and frontmatter support | 7.22.3 | `vendor/milkdown.min.js` | MIT and bundled dependency licenses | https://github.com/Milkdown/milkdown |

## marked

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Licensed under the MIT License. Full text: https://github.com/markedjs/marked/blob/v15.0.12/LICENSE.md

## DOMPurify

Copyright (c) Cure53 and other contributors.

Dual-licensed under the Apache License 2.0 and the Mozilla Public License 2.0; epic-board uses it under the Apache License 2.0. Full text: https://github.com/cure53/DOMPurify/blob/3.2.6/LICENSE

## Milkdown editor bundle

Milkdown is licensed under MIT, Copyright (c) 2020-present Mirone. The bundle also includes ProseMirror, remark and their dependencies; complete bundled license texts are in `vendor/milkdown.LICENSE.txt`.

The editor integration source, pinned build dependencies and lockfile are in `scripts/vendor/`. Rebuild with `node scripts/vendor/build.mjs`; dependencies are installed in a temporary directory and are not needed to run epic-board.

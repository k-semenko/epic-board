# Contributing

Issues and pull requests are welcome. For anything larger than a small fix, open an issue first so the approach can be agreed before you write code.

## Development setup

- Node.js 22 or newer. There are no npm dependencies to install.
- Run the tests:

  ```sh
  npm test   # node --test "test/**/*.test.mjs"
  ```

- Run the server against a throwaway data directory so your real board is not touched:

  ```sh
  EPIC_BOARD_HOME=$(mktemp -d) EPIC_BOARD_PORT=4799 node server/index.mjs
  ```

  Then open http://127.0.0.1:4799.

## Code style

- ES modules with the `.mjs` extension.
- No runtime dependencies. A pull request that adds one needs prior discussion in an issue.
- Code comments in English, at most two lines, explaining why rather than what.
- Behaviour changes come with tests in `test/`.
- User-facing UI strings go through the i18n dictionary `server/page/i18n.mjs`, with both `en` and `ru` entries.
- Test fixtures must not contain personal data, real hostnames or absolute paths from your machine.

## Commits and pull requests

- Commit subject: one line, imperative mood (`Add export of stage documents`, not `Added ...`).
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for user-visible changes.
- A Developer Certificate of Origin sign-off is not required.

## Releases

Releases are cut by the maintainer:

1. Bump the version in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
2. Move the `Unreleased` entries in `CHANGELOG.md` under the new version.
3. Push a tag `vX.Y.Z`. CI publishes the GitHub Release.

Details are in `docs/releasing.md`.

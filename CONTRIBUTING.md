# Contributing

Thanks for your interest in markode! Issues and pull requests are welcome.

## Setup

Requires Node.js 20+ and [pnpm](https://pnpm.io) (the version is pinned in `package.json`; `corepack enable`
picks it up). Please don't use npm or yarn inside the repo.

```bash
pnpm install
pnpm dev        # server on :4319 (this repo as root) + Vite on http://localhost:4320
pnpm typecheck
pnpm build      # required before `node dist/cli.js` serves the UI
```

## Guidelines

- Read [docs/SPEC.md](docs/SPEC.md) and the conventions in [CLAUDE.md](CLAUDE.md) first.
- Code, comments, commit messages and every `.md` file are in English. UI strings go through
  `web/src/i18n.ts`, so add new keys to every language there.
- Colors are CSS tokens in `web/src/styles.css`; don't hard-code them in components or editor code.
- The editor must never reformat a user's file on save. Only the table being edited is re-serialized.
- Keep changes focused and match the surrounding code style.
- Before opening a PR, make sure `pnpm typecheck` and `pnpm build` pass. For editor changes, check them
  in the browser, e.g. with [docs](docs/) or your own Markdown.

## Reporting bugs

Open an issue with the steps to reproduce, what you expected, what happened, your OS, browser and
Node version, and a minimal Markdown snippet if the problem is in the editor.

For security issues, see [SECURITY.md](SECURITY.md) instead.

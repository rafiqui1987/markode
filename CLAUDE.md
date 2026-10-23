# markode

Visual editor for a project's Markdown (CLAUDE.md, AGENTS.md, docs/). Spec: `docs/SPEC.md`.

## Structure

```tree
src/
  cli/       # entry (index.ts) and interactive init (clack)
  core/      # scan, i18n sync state, rule presets, git, dashboard, scaffold
  server/    # http API + websocket file watcher, serves dist/web
web/src/
  editor/    # CodeMirror 6: live preview, slash menu, widgets (table, tree, mermaid)
  components/  # Sidebar, Editor, Pages (dashboard, changes, rules)
templates/   # rule presets, docs scaffold, AI skill
```

## Commands

- `pnpm dev` — server on :4319 + Vite on :4320
- `pnpm build` — required before `node dist/cli.js` serves the UI
- `pnpm typecheck`

## Conventions

- All `.md` files and UI source strings in English; UI translations live in `web/src/i18n.ts` (en/es/fr).
- Colors are CSS tokens in `web/src/styles.css`; editor token colors reference them.
- Never reformat a user's file on save; only the edited table is re-serialized.

<!-- markode:rules:start -->
## Working rules

This project uses markode: follow `.claude/skills/markode/SKILL.md` when editing any `.md` file.

<!-- markode:source-lang:en -->
- Source language of every `.md` file: **English** (`en`).

<!-- rule:ask-before-commit -->
- Never commit, push or open pull requests without asking first.

<!-- rule:pnpm-only -->
- Never use npm or yarn; always use pnpm (`pnpm add`, `pnpm dlx`, `pnpm exec`).

<!-- rule:lang-es-code-en -->
- Write prompts answers and explanations in Spanish.
- Write code, comments, commit messages and every `.md` file in English.
<!-- markode:rules:end -->

<!-- markode:proposals:start -->
## Proposals

When an answer would be long, has options or a design to validate, or the user asks for one, write a
temporary proposal the user answers in markode instead of a chat answer (skill: `markode-proposals`).

- Where: `docs/proposals/NNN-short-name.md` (NNN: the next number in that folder, counting `applied/`).
- After writing one, run `markode wait <path>` in the background: it returns when the user answers in markode.
- The user ticks options and comments (`<!-- comment by … -->`). When it is answered, reply to the comments,
  update every doc that depends on the decision (tasks, phases, architecture…), then archive the proposal:
  `status: applied`, moved to the `applied/` folder next to it. Never read or search archived proposals
  unless the user asks about a past one.
<!-- markode:proposals:end -->

---
name: markode
description: Conventions for every .md file in this project (CLAUDE.md, AGENTS.md, docs/), opening the editor (/markode), linking docs in your answers, keeping the docs consistent (/markode sync) and translating them (/markode translate). Use when creating or editing any .md file, when you mention a .md file to the user, at the start and end of a session, or when the user runs /markode, /markode sync or /markode translate.
---

# markode

The user reads and edits this project's Markdown in **markode**, a visual editor. Write `.md` files so it can present them well.

## Opening the editor (`/markode`)

When the user runs `/markode` with nothing after it, run `markode url` (use `pnpm exec markode` if it is
a local dependency). It starts the editor in the background when it isn't running for this project and
prints its link; answer with that link in one line. `markode stop` stops it.

## Links to docs

When you point the user to a `.md` file (a proposal you wrote, a doc you changed or cite), give a link
they can click in the terminal: `[docs/proposals/003-auth.md](http://localhost:4319/open?path=docs/proposals/003-auth.md)`.

- Get the link with `markode url <path>` (it starts the editor if needed); once you know the port, build
  the next ones the same way, without running it again.
- `/open` shows the doc in the markode tab the user already has open, and the tab the click opened
  closes itself. Never link to `/#/<path>`: that opens a new editor tab each time.
- Code and other files keep `path:line` references, which open in the user's code editor.

## Language

- Every `.md` file is written in the project's **source language**, declared in the main doc's "Working rules" section (`<!-- markode:source-lang:xx -->`, default English). Frontmatter keys are always English.
- Translations live in `.markode/i18n/<lang>/<same path>` (hidden, git-ignored). Never treat them as sources.

## CLAUDE.md and AGENTS.md

Claude Code reads `CLAUDE.md`; Codex, Cursor, Gemini and most other agents read `AGENTS.md`. At the
start of a session, run `markode link --dry-run`. If it lists files to create (for example, the project
was set up with another agent and has only `AGENTS.md`), ask the user once, in one line, whether to
create them. Each one only points to the existing doc; nothing is copied.

- Yes: `markode link`.
- No: `markode link --skip`, so it isn't offered again.

## While you work: the user's edits and comments

The user keeps editing docs and commenting in markode while you work. `markode changes` lists what they
did since you were last told (and marks it as told): docs they edited, with the section, and new
comments. In Claude Code, hooks run it for you after every step when the project set them up (you then
see a "markode: the user changed docs…" note); otherwise run `markode changes --start` at the start of
the session and `markode changes` between steps.

- **An edited doc**: note it. Re-read it before you work on that part of the project; until then, do
  nothing about it.
- **A comment on what you are working on** (the doc, section or task at hand): take it into this
  session. Reply right below it, with the same indentation, and apply what it asks:
  `<!-- reply by AI, YYYY-MM-DD: what you did or why not -->`
- **A comment on anything else**: ask the user in one line whether to take it now or leave it. Then reply
  below it with what was decided.
- Never delete or rewrite the user's comments (they resolve them in markode), and never put `-->` inside
  a comment's text. Comments in a proposal come with its answer instead (see the proposals skill).

## Frontmatter

Docs that track work start with a frontmatter block; the markode dashboard reads it:

```yaml
---
type: task         # vision | architecture | phase | tasks | task | note
status: pending    # pending | in-progress | blocked | done
phase: 2           # phases: their order; tasks: the phase they belong to
updated: YYYY-MM-DD
---
```

- Update `status` and `updated` whenever you change the doc.
- If the main doc has a "Workflow (markode method)" section, follow it: it says where vision,
  architecture, phases and tasks live, and how to start and close a session.

## Content conventions

| Need | Use |
|---|---|
| Tasks / progress | GFM checklists `- [ ]` / `- [x]`; optional `#tag` and `@priority` at the end |
| Rules, decisions, lists of records | GFM tables, first column `id` |
| Folder / module structure | a ` ```tree ` block: indented lines; two spaces + `#` starts a description |
| Flows, sequences, states | a ` ```mermaid ` block |

Never edit the section between `<!-- markode:rules:start -->` and `<!-- markode:rules:end -->` by hand; it is generated from the user's rule presets.

## Docs sync (`/markode sync`)

Keeps the docs consistent; it never touches translations. Run it when the user asks for `/markode sync`,
at the start of a session (answered proposals first), after editing `.md` files and when closing a session.

1. `markode check --json` (use `pnpm exec markode` if it is a local dependency). It returns:
   `{ proposals, phases: [{ phase, task, ticked, status }], projects: { missing, gone } | null, links: [{ file, line, target }] }`.
2. `proposals`: answered proposals. Apply each one as the `markode-proposals` skill says ("When the user answers").
3. `phases`: tick a task in its phase when it is `done`, untick it when it isn't; then set the phase's
   `status` (`in-progress` once a task started, `done` when every task and "Definition of done" item is ticked).
4. `projects`: projects missing from the main doc's "Projects" table, or rows whose folder is gone. Ask the
   user before adding or removing rows.
5. `links`: fix links to docs that were moved (find the new path); ask about docs that were deleted.
6. Tell the user in one or two lines what you changed. If nothing came up, say the docs are consistent.

## Translations (`/markode translate`)

Only when the user asks for `/markode translate` (markode shows a button to copy it when translations
fall behind). With the browser engine, markode translates by itself; the agent is still the one for
`conflict`, for files not in the source language, and for edited translations markode can't map back
(paragraphs added or removed). Never translate as a side effect of other work, and never change a source
file without the user's approval.

1. `markode translate --status --json`. It returns
   `{ sourceLang, langs, names, foreign: [{ path, detected }], files: [{ path, lang, status, translation }] }`.
   `names` maps each language code to its name (`ja` → `Japanese`): translate into that language, also for
   codes the user added by hand.
2. `missing` or `outdated`: run `markode translate --segments [--lang <lang>]`. It returns
   `{ sourceLang, names, files: [{ path, lang, pending: [{ key, text, terms }] }] }`: only the prose that
   has no cached translation (code, links, frontmatter keys and markers are kept by markode). Translate
   each `text` into `names[lang]`, keeping every `{0}`-style placeholder exactly once and using `terms`
   (fixed translations from the glossary). Write `{ "<lang>": { "<key>": "<translation>" } }` to a
   temporary file and run `markode translate --apply <file>`: it writes the translation files and marks
   them in sync. Translate again any segment it reports as having lost a placeholder.
3. **Changes that would touch a source file: ask first.** In one message, list each file with a one-line
   summary of what would change, and apply only what the user approves:
   - `pending-sync`: the user edited the translation; their changes would go into the source `path`
     (translated into the source language, untouched parts byte-identical).
   - `conflict`: both changed; propose a merge (source wins on contradictions) and show what conflicts.
   - `foreign`: files not written in the source language; offer to convert them. For the ones the user
     wants to keep: `markode translate --keep <path> [<path>...]`.
   After applying, regenerate that file's translations in every language. What the user doesn't approve
   stays as it is (still `pending-sync` or `conflict`).
4. `markode translate --mark --lang <lang> <path> [<path>...]` for every translation you wrote by hand
   in step 3 (without `--lang` it marks every enabled language); `--apply` marks its own.

Translation rules: keep frontmatter keys, code blocks, `tree` and `mermaid` identifiers, link targets, table structure and the `<!-- ... -->` markers unchanged; translate only human text (including frontmatter values like titles, but not `status`/`type` values).

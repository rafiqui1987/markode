---
name: mdrules
description: Conventions for every .md file in this project (CLAUDE.md, AGENTS.md, docs/), keeping the docs consistent (/mdrules sync) and translating them (/mdrules translate). Use when creating or editing any .md file, at the start and end of a session, or when the user runs /mdrules sync or /mdrules translate.
---

# mdrules

The user reads and edits this project's Markdown in **mdrules**, a visual editor. Write `.md` files so it can present them well.

## Language

- Every `.md` file is written in the project's **source language**, declared in the main doc's "Working rules" section (`<!-- mdrules:source-lang:xx -->`, default English). Frontmatter keys are always English.
- Translations live in `.mdrules/i18n/<lang>/<same path>` (hidden, git-ignored). Never treat them as sources.

## Frontmatter

Docs that track work start with a frontmatter block; the mdrules dashboard reads it:

```yaml
---
type: task         # vision | architecture | phase | tasks | task | note
status: pending    # pending | in-progress | blocked | done
phase: 2           # phases: their order; tasks: the phase they belong to
updated: YYYY-MM-DD
---
```

- Update `status` and `updated` whenever you change the doc.
- If the main doc has a "Workflow (mdrules method)" section, follow it: it says where vision,
  architecture, phases and tasks live, and how to start and close a session.

## Content conventions

| Need | Use |
|---|---|
| Tasks / progress | GFM checklists `- [ ]` / `- [x]`; optional `#tag` and `@priority` at the end |
| Rules, decisions, lists of records | GFM tables, first column `id` |
| Folder / module structure | a ` ```tree ` block: indented lines; two spaces + `#` starts a description |
| Flows, sequences, states | a ` ```mermaid ` block |

Never edit the section between `<!-- mdrules:rules:start -->` and `<!-- mdrules:rules:end -->` by hand; it is generated from the user's rule presets.

## Docs sync (`/mdrules sync`)

Keeps the docs consistent; it never touches translations. Run it when the user asks for `/mdrules sync`,
at the start of a session (answered proposals first), after editing `.md` files and when closing a session.

1. `mdrules check --json` (use `pnpm exec mdrules` if it is a local dependency). It returns:
   `{ proposals, phases: [{ phase, task, ticked, status }], projects: { missing, gone } | null, links: [{ file, line, target }] }`.
2. `proposals`: answered proposals. Apply each one as the `mdrules-proposals` skill says ("When the user answers").
3. `phases`: tick a task in its phase when it is `done`, untick it when it isn't; then set the phase's
   `status` (`in-progress` once a task started, `done` when every task and "Definition of done" item is ticked).
4. `projects`: projects missing from the main doc's "Projects" table, or rows whose folder is gone. Ask the
   user before adding or removing rows.
5. `links`: fix links to docs that were moved (find the new path); ask about docs that were deleted.
6. Tell the user in one or two lines what you changed. If nothing came up, say the docs are consistent.

## Translations (`/mdrules translate`)

Only when the user asks for `/mdrules translate` (mdrules shows a button to copy it when translations
fall behind). Never translate as a side effect of other work, and never change a source file without
the user's approval.

1. `mdrules translate --status --json`. It returns
   `{ sourceLang, langs, names, foreign: [{ path, detected }], files: [{ path, lang, status, translation }] }`.
   `names` maps each language code to its name (`ja` → `Japanese`): translate into that language, also for
   codes the user added by hand.
2. `missing` or `outdated`: translate the source `path` into `lang` and write it to `translation`.
3. **Changes that would touch a source file: ask first.** In one message, list each file with a one-line
   summary of what would change, and apply only what the user approves:
   - `pending-sync`: the user edited the translation; their changes would go into the source `path`
     (translated into the source language, untouched parts byte-identical).
   - `conflict`: both changed; propose a merge (source wins on contradictions) and show what conflicts.
   - `foreign`: files not written in the source language; offer to convert them. For the ones the user
     wants to keep: `mdrules translate --keep <path> [<path>...]`.
   After applying, regenerate that file's translations in every language. What the user doesn't approve
   stays as it is (still `pending-sync` or `conflict`).
4. `mdrules translate --mark --lang <lang> <path> [<path>...]` for every translation you wrote (without
   `--lang` it marks every enabled language).

Translation rules: keep frontmatter keys, code blocks, `tree` and `mermaid` identifiers, link targets, table structure and the `<!-- ... -->` markers unchanged; translate only human text (including frontmatter values like titles, but not `status`/`type` values).

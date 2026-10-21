---
name: mdrules
description: Conventions for every .md file in this project (CLAUDE.md, AGENTS.md, docs/) and the translation sync. Use when creating or editing any .md file, when finishing a task or phase, at the start of a session, or when the user runs /mdrules sync.
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

## Translation sync (`/mdrules sync`)

Run this when the user asks for `/mdrules sync`, at the start of a session, and after you edit any `.md` file.

1. `mdrules sync --status --json` (use `pnpm exec mdrules` if it is a local dependency). It returns:
   `{ sourceLang, langs, names, foreign: [{ path, detected }], files: [{ path, lang, status, translation }] }`.
   `names` maps each language code to its name (`ja` → `Japanese`): translate into that language, also for
   codes the user added by hand.
2. **Files not in the source language** (`foreign`): ask the user, in one question listing them, whether to convert each one to `sourceLang`.
   - Yes: rewrite the file in place in the source language, keeping structure, code, links and markers byte-identical.
   - No: `mdrules sync --keep <path> [<path>...]` so they are not offered again.
3. **Translations** (`files`, one entry per enabled language), by status:
   - `missing` or `outdated`: translate the source `path` into `lang`, write it to `translation`.
   - `pending-sync`: the user edited the translation. Apply their changes to the source `path` (translated into the source language, untouched parts byte-identical), then regenerate `translation` — and the other languages' translations of that file.
   - `conflict`: both changed. Merge into the source file (source wins on contradictions), regenerate the translations, and tell the user what conflicted.
   - `synced`: nothing to do.
4. `mdrules sync --mark --lang <lang> <path> [<path>...]` for every translation you wrote (without `--lang` it marks every enabled language).

Translation rules: keep frontmatter keys, code blocks, `tree` and `mermaid` identifiers, link targets, table structure and the `<!-- ... -->` markers unchanged; translate only human text (including frontmatter values like titles, but not `status`/`type` values).

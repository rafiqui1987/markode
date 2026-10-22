---
type: architecture
status: in-progress
updated: 2026-10-21
---

# mdrules — Functional Specification

Local visual editor for a project's `.md` files (CLAUDE.md, AGENTS.md, /docs and any .md),
so humans can edit comfortably while the AI keeps reading plain Markdown.

## 1. Install and run

- Installed as a library: `pnpm add -D mdrules` (or global).
- Run from the root of any project: `pnpm mdrules` → starts a local server and opens the browser.
- Works in **monorepos**: each folder with its own `CLAUDE.md` / `AGENTS.md` is a "project" with its own rules.

## 2. First run (init)

| Situation | Behavior |
|---|---|
| `AGENTS.md` or `CLAUDE.md` exists | Ask: "Use this as the main document?" (with saved defaults: use it) |
| Only `AGENTS.md`, Claude Code used | Add a one-line `CLAUDE.md` that imports it (`@AGENTS.md`) |
| Both exist | Ask which one is the main one |
| Neither exists | Offer to create it |
| Monorepo, front + back, folder of repos | Detect the projects; each gets its own main doc and `docs/tasks/` |
| Project kind (app, library, mobile, data/ML, infrastructure, microservices) | Detected from files; asked when unclear; only that kind's questions |
| Existing docs | Ask which are official; the main doc points the agent to them |
| Always | Ask which **rule presets** to apply, none by default (see §3) |

With the mdrules method, the setup creates only the task folder; vision, architecture and phases are
created by the agent from the `mdrules-method` skill templates when there is something to write. A
task's status lives only in its frontmatter (no task index).

Init also installs the skill in `.claude/skills/mdrules/` so the AI writes using the conventions.

## 3. Rule presets

Reusable rules describing *how I work*, selectable on every init.

- Stored globally at `~/.mdrules/rules/*.md` (one file per rule), reusable across projects.
- mdrules ships some defaults; the user can create, edit and delete their own from the app.
- On init: multi-select checklist of available rules.
- Selected rules are written into the main doc inside a managed section, so they can be updated later without touching the rest of the file:

```md
<!-- mdrules:rules:start -->
## Working rules
- Never commit, push or open pull requests without asking first.
- Change only what the task needs: don't refactor, rename or reformat unrelated code.
<!-- mdrules:rules:end -->
```

The setup offers no rules by default (start from scratch). The library starts with common rules for AI
agents; each user edits it and adds their own in the Rules tab:

| id | rule |
|---|---|
| ask-before-commit | Never commit, push or open pull requests without asking first |
| verify-before-done | Run tests, linter and type checker before saying a task is done |
| minimal-changes | Change only what the task needs |
| match-conventions | Match the surrounding code's style, naming and libraries |
| ask-new-dependencies | Don't add, remove or upgrade dependencies without asking |
| protect-secrets | Never read, print or commit secrets or `.env` files |
| ask-when-unclear | Ask instead of guessing; state assumptions |
| tests-with-changes | Add or update tests with every behavior change |
| update-docs | Update the docs that describe changed behavior |

## 4. Language

- Every project has a **source language** (default English): every `.md` file is written in it.
  It is declared in the main doc's managed section (`<!-- mdrules:source-lang:xx -->`), so the team and the AI share it.
- Each user enables any number of **translation languages**: English, Spanish, French, Portuguese, German, Italian.
- The language selector switches between the original and each translation: sidebar and documents follow it. Translations can be **edited**.
- The **interface language** is a separate, personal setting (Settings → General), English by default.
- The source file is never overwritten by the app directly from a translation.
- Translation is done by the **AI through the skill** (no API key in the app).
- Files whose prose is not in the source language are flagged (badge + banner). `/mdrules translate` asks whether to convert them; "no" is remembered (`mdrules translate --keep`).

### Storage

- Translations live in a hidden folder `.mdrules/i18n/<lang>/`, mirroring the original paths:

```tree
.mdrules/                  # hidden, git-ignored
  state.json               # hashes + sync status per file
  i18n/
    es/
      CLAUDE.md
      docs/
        SPEC.md
```

- Init adds `.mdrules/` to `.gitignore` → translations never reach the repo.
- Init also offers to hide `.mdrules/` in the code editor (e.g. VS Code `files.exclude`), so the project only shows the English files.
- The mdrules sidebar always shows the English tree; with a second language enabled, opening a file transparently loads its translation.

### Sync flow

`state.json` keeps, per file, the hash of the English source and of the translation.

| Detected change | Status | What the AI does on `/mdrules translate` |
|---|---|---|
| English changed | `outdated` | Re-translates into the second language |
| Translation edited by the user | `pending-sync` | Asks; if approved, updates the English file, then refreshes the translations |
| Both changed | `conflict` | Asks with a proposed merge (English wins on contradictions) |
| No translation yet | `missing` | Translates the file |

- Translating only happens when the user asks for `/mdrules translate`; mdrules shows a "to translate"
  counter in the top bar and in Settings, with a button that copies the command.
- `/mdrules sync` is a different job: it keeps the docs consistent (answered proposals, phases vs tasks,
  projects table, broken links; `mdrules check`), at the start and end of each session.

## 5. Settings

Global per user (`~/.mdrules/settings.json`), opened from the gear in the top bar:

| Setting | Values |
|---|---|
| Font | Inter, IBM Plex Sans, Atkinson Hyperlegible, Source Serif, Lora, JetBrains Mono, System |
| Size | 12–22 px slider |
| Line spacing | 1.2–2.2 slider |
| Indent (side margin) | 0–200 px slider |
| Line width | Full / Readable (820 px) |

The same panel holds the project's source language and the user's translation languages.

## 6. Layout

- **Sidebar**: tree of .md files, VS Code style.
  - Monorepo: **single tree**; packages with CLAUDE.md/AGENTS.md are marked as projects.
  - Right click → **ignore** folder or file. Stored in `.mdrulesignore` (committed to the repo).
- **Breadcrumbs** at the top with the selected file's path.
- **Language switch** (EN / second language) at the top.
- **Editor panel**: minimal indentation, maximum usable width.

## 7. Editor

- Engine: **CodeMirror 6** in **live preview** mode: single panel; Markdown is syntax-colored and
  everything not under the cursor is rendered (mermaid, trees, tables, checkboxes). Cursor on it → raw source.
- Files are saved **exactly** as written (no reformatting) → clean diffs, readable by the AI.
- **Colors per element type**: headings (one tone per level), inline code and code blocks, lists,
  checkboxes, tables, links, frontmatter.

### Cursor command menu

- Opens with `/` at the start of a line (and `Ctrl+Space` anywhere).
- **Grouped and numbered**, every option with an icon. Pressing the number opens the submenu:

```tree
1. Headings
  1. # H1
  2. ## H2
  3. ### H3
  4. #### H4
2. Lists
  1. Bullets
  2. Numbered
  3. Checklist
3. Table
  1. New table
  2. Add row
  3. Add column
4. Code
  1. Inline
  2. Block
5. Diagrams
  1. Mermaid
  2. Tree
6. Other
  1. Quote
  2. Link
  3. Divider
  4. Frontmatter
```

## 8. Frontmatter conventions

```yaml
type: phase        # phase | tasks | rules | architecture | decision | note
status: pending    # pending | in-progress | done | blocked
phase: 2           # order, only for type: phase
updated: 2026-10-21
```

Phases are created over time as the project evolves; no fixed structure up front.

## 9. Decisions

| id | decision |
|---|---|
| D1 | Frontmatter keys and all `.md` files in English |
| D2 | Tool name `mdrules`; installed with pnpm |
| D3 | Translation done by the AI via the skill (`/mdrules translate`), no API key |
| D4 | Translations in `.mdrules/i18n/`, hidden and git-ignored |
| D5 | Base `/docs`: `architecture.md`, `rules.md`, `tasks.md`, `decisions.md`, `phases/` |
| D6 | Palette: dark by default + light theme; one hue per element type (CSS tokens in `web/src/styles.css`) |
| D7 | Changes view: `git diff` against HEAD grouped by Markdown section |
| D8 | Dashboard: phase cards (`type: phase`) with checkbox progress + documents grouped by `type` |
| D10 | Source language configurable per project (managed section of the main doc); translations per user, multiple allowed |
| D11 | Language detection: stopword heuristic, prose only; files under 25 words are not flagged |
| D9 | Stack: Node CLI (`src/`) + React/Vite + CodeMirror 6 web UI (`web/`), local server on port 4319 |

## 10. Next

- [ ] "Mark as reviewed" snapshot in the changes view
- [ ] Rename / move / delete files from the sidebar
- [ ] Publish to npm

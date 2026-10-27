---
type: architecture
status: in-progress
updated: 2026-10-21
---

# markode — Functional Specification

Local visual editor for a project's `.md` files (CLAUDE.md, AGENTS.md, /docs and any .md),
so humans can edit comfortably while the AI keeps reading plain Markdown.

## 1. Install and run

- Installed as a library: `pnpm add -D @rafiqui987/markode` (or global).
- Run from the root of any project: `pnpm markode` → starts a local server and opens the browser.
- Works in **monorepos**: each folder with its own `CLAUDE.md` / `AGENTS.md` is a "project" with its own rules.

## 2. First run (init)

The viewer is always installed. Everything else is a **module** (`src/core/features.ts`), chosen in one
question through a profile, and turned on or off later in Settings → Features or `markode features`:

| Profile | Modules |
|---|---|
| Viewer only | none: nothing is written to the project |
| Viewer + AI agent (recommended) | agent, rules, proposals, live changes, translations, skills, hide in VS Code |
| Complete | the above + dashboard and tasks |
| Choose the modules | any set; a module that needs the agent turns it on |

| Module | Needs | Writes | Off removes |
|---|---|---|---|
| AI agent | — | `markode` skill in `.claude/skills/` and/or `.agents/skills/` (per the agents the project uses), `markode:rules` section with the source language | the skill and the section (the source language is remembered in `.markode/config.json`) |
| Working rules | agent | rules inside `markode:rules`; the Rules tab | the rules (remembered, restored when turned back on) |
| Proposals | agent | `markode-proposals` skill, `markode:proposals` section | both; proposals and comments stay |
| Live changes | agent | hooks in `.claude/settings.local.json` (personal) | markode's hooks only |
| Translations | agent | `.markode/` only; the language switcher | nothing on disk; languages are kept |
| Dashboard and tasks | — | the Dashboard tab; with the agent, the markode method (`docs/`, `markode-*` skills, `markode:workflow`) | the skills and section; docs and tasks stay |
| Skills | — | the Skills tab | — |
| Hide in VS Code | — | `files.exclude` in `.vscode/settings.json` | that entry |

The first choice is saved as the default for new projects (`~/.markode/defaults.json`), which then ask
nothing; `markode setup` changes it or switches to asking in each project. `init --profile <name>` and
`init --yes` never ask. Setting a project up again only adds modules.

Detected instead of asked (`init --custom` asks them all):

| Situation | Behavior |
|---|---|
| `AGENTS.md` or `CLAUDE.md` exists | Used as the main document (both: the default one, `CLAUDE.md`) |
| Only `AGENTS.md`, Claude Code used | Add a one-line `CLAUDE.md` that imports it (`@AGENTS.md`) |
| Neither exists | Create the default one |
| Source language | Detected from the project's docs before markode writes its own; the default otherwise |
| Monorepo, front + back, folder of repos | Detect the projects; each gets its own main doc and `docs/tasks/` |
| Project kind (app, library, mobile, data/ML, infrastructure, microservices) | Detected from files |
| Existing docs | All are official; the main doc points the agent to them |
| OpenSpec or Spec Kit already there | Kept and shown in the dashboard |
| Rules | The saved defaults' rules, none by default (see §3) |

With the markode method, the setup creates only the task folder; vision, architecture and phases are
created by the agent from the `markode-method` skill templates when there is something to write. A
task's status lives only in its frontmatter (no task index).

markode keeps its state in `.markode/`, which ignores itself in git (`.markode/.gitignore`). When the
editor starts, the skills and sections markode installed are refreshed to the running version.

### Skills tab

Lists the user's global skills (`~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`,
`~/.gemini/skills`, `~/.copilot/skills`, `~/.cursor/skills`). For each kind of agent the project uses
(`claude`: Claude Code, which reads only `~/.claude/skills` and `.claude/skills/`; `agents`: the others,
through `.agents/skills/`), each skill shows its status: `global` (active everywhere, nothing to do;
copying it only shares it with the team), `missing` (another agent's: copy it to use it), `project`, or
`both` (two copies; Claude Code runs the personal one, the team gets the project one). A project copy
whose `SKILL.md` differs from the global one is flagged, with an update from the global one. Nothing
is copied without the user asking.

## 3. Rule presets

Reusable rules describing *how I work*, selectable on every init.

- Stored globally at `~/.markode/rules/*.md` (one file per rule), reusable across projects.
- markode ships some defaults; the user can create, edit and delete their own from the app.
- On `init --custom` and `setup --custom`: multi-select checklist of available rules; otherwise the saved defaults.
- Selected rules are written into the main doc inside a managed section, so they can be updated later without touching the rest of the file:

```md
<!-- markode:rules:start -->
## Working rules
- Never commit, push or open pull requests without asking first.
- Change only what the task needs: don't refactor, rename or reformat unrelated code.
<!-- markode:rules:end -->
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
  It is declared in the main doc's managed section (`<!-- markode:source-lang:xx -->`), so the team and the AI share it.
- Each user enables any number of **translation languages**: English, Spanish, French, Portuguese, German, Italian.
- The language selector switches between the original and each translation: sidebar and documents follow it. Translations can be **edited**.
- The **interface language** is a separate, personal setting (Settings → General), English by default.
- The source file is never overwritten by the app directly from a translation.
- Translation is done by the **AI through the skill** (no API key in the app).
- Files whose prose is not in the source language are flagged (badge + banner). `/markode translate` asks whether to convert them; "no" is remembered (`markode translate --keep`).

### Storage

- Translations live in a hidden folder `.markode/i18n/<lang>/`, mirroring the original paths:

```tree
.markode/                  # hidden, git-ignored
  state.json               # hashes + sync status per file
  i18n/
    es/
      CLAUDE.md
      docs/
        SPEC.md
```

- Init adds `.markode/` to `.gitignore` → translations never reach the repo.
- Init also offers to hide `.markode/` in the code editor (e.g. VS Code `files.exclude`), so the project only shows the English files.
- The markode sidebar always shows the English tree; with a second language enabled, opening a file transparently loads its translation.

### Sync flow

`state.json` keeps, per file, the hash of the English source and of the translation.

| Detected change | Status | What the AI does on `/markode translate` |
|---|---|---|
| English changed | `outdated` | Re-translates into the second language |
| Translation edited by the user | `pending-sync` | Asks; if approved, updates the English file, then refreshes the translations |
| Both changed | `conflict` | Asks with a proposed merge (English wins on contradictions) |
| No translation yet | `missing` | Translates the file |

- Translating only happens when the user asks for `/markode translate`; markode shows a "to translate"
  counter in the top bar and in Settings, with a button that copies the command.
- `/markode sync` is a different job: it keeps the docs consistent (answered proposals, phases vs tasks,
  projects table, broken links; `markode check`), at the start and end of each session.

## 5. Settings

Global per user (`~/.markode/settings.json`), opened from the gear in the top bar:

| Setting | Values |
|---|---|
| Font | Inter, IBM Plex Sans, Atkinson Hyperlegible, Source Serif, Lora, JetBrains Mono, System |
| Size | 12–22 px slider |
| Line spacing | 1.2–2.2 slider |
| Indent (side margin) | 0–200 px slider |
| Line width | Full / Readable (820 px) |

The same panel holds the project's modules (Features: what each does and writes, with a switch), the
project's source language and the user's translation languages (shown with the AI agent and Translations on).

## 6. Layout

- **Sidebar**: tree of .md files, VS Code style.
  - Monorepo: **single tree**; packages with CLAUDE.md/AGENTS.md are marked as projects.
  - Right click → **ignore** folder or file. Stored in `.markodeignore` (committed to the repo).
  - **Search** (header button) has two modes, the last one remembered: **Names** filters the tree by
    path; **Content** searches inside every doc, VS Code style (`Ctrl+Shift+F` opens it with the
    editor's selection).
    - Results grouped by file with the matching line; a click opens the doc with the match selected.
    - Toggles: match case, whole word, regex, and **ignore Markdown syntax** (on by default: matches the
      text as it reads, without `**`, link URLs or HTML comments; the frontmatter is searched too).
    - Files to include / exclude: comma-separated globs, `.gitignore` style. Ignored files only with
      "show ignored". With a translation selected, it searches the translations.
    - **Replace**: one match, one file or all files (all asks for confirmation). Only the matched text
      changes; a match spanning Markdown syntax (`foo **bar**`) can't be replaced from the results.
    - Results refresh when files change on disk; at most 2000 matches are shown.
- **Breadcrumbs** at the top with the selected file's path.
- **Language switch** (EN / second language) at the top.
- **Editor panel**: minimal indentation, maximum usable width.

## 7. Editor

- Engine: **CodeMirror 6**, single panel, two views (one button at the top right switches; every file opens in the markode view):
  - **markode view** (default): Markdown syntax is always hidden and rich blocks are rendered (mermaid, trees,
    tables, checkboxes), wherever the cursor is. The cursor steps over hidden syntax and never rests
    before a heading, list or quote prefix. A block shows its source only from its `</>` button (inline
    math, images and footnotes on click), until the cursor leaves it.
  - **Markdown**: the plain source, syntax-colored.
- **Links**: a click follows them (relative `.md` links open in markode, the rest in the browser).
  Hovering shows the target with subtle buttons to edit it (text and URL) or copy it. Formatting the
  text of a link keeps the link (`[**text**](url)`).
- **Applied proposals are archived, not deleted**: the agent sets `status: applied` and moves the file to
  an `applied/` folder next to it. Any `applied/` folder inside a `proposals/` folder is always ignored:
  hidden in the sidebar (shown with "show ignored", without the option to un-ignore it), and left out
  of the dashboard, `markode check`, translations and `markode changes`. The skills tell agents never
  to read or search it unless the user asks about a past proposal.
- **The user's edits while an agent works**: every save from markode is logged (comments added, and the
  section of any other edit; proposals excluded, their comments travel with the answer) in
  `~/.markode/projects/<hash of the project's real path>/activity.jsonl`, outside the project so a
  repository can't ship one. `markode changes` reports what the agent hasn't been told yet;
  `--start` marks a new session; `--hook <event>` prints it as Claude Code hook output, silent when nothing
  changed. The Live changes module adds the `SessionStart`, `UserPromptSubmit` and `PostToolUse` hooks to
  `.claude/settings.local.json`.
- **HTML comments** in the markode view (comment threads and `<!-- choose: one -->` keep their own widgets):
  - A note (`<!-- any text -->`, hidden when rendered elsewhere but read by agents): a subtle icon; the
    text shows on hover, a click shows the comment to edit it.
  - A region a tool manages (`<!-- name:key:start -->` … `<!-- name:key:end -->`, e.g. `markode:rules`):
    a thin bracket along its lines with a small label; the markers are hidden.
  - A marker tools read (`<!-- markode:source-lang:es -->`, `<!-- rule:pnpm-only -->`): a chip with the
    language, or a small tag icon with the marker on hover.
- **Actions** at the top right: undo, redo, discard changes, find and replace (also `Ctrl+F`/`Ctrl+H`
  with the focus anywhere in the app, instead of the browser's), copy (the selection or the whole document,
  as Markdown or as formatted text for Word/Docs/mail), PDF export (A4 or A3, portrait or landscape, in the
  markode view's colors or plain black and white, always on a light page; through the browser's print dialog
  with the paper already set) and the markode/Markdown view switch.
- Files are saved **exactly** as written (no reformatting) → clean diffs, readable by the AI.
- **Colors per element type**: headings (one tone per level), inline code and code blocks, lists,
  checkboxes, tables, links, frontmatter.

### Cursor command menu

- Opens with `/` at the start of a line (and `Ctrl+Space` anywhere).
- **Grouped and numbered**, every option with an icon. Pressing the number (or `→`) opens the submenu;
  `0`, `←` or `Backspace` goes back to the groups.
- Options apply to the **current line or the selection**: headings, lists and quotes prefix every
  selected line (numbered lists count up), code blocks and diagrams fence the lines, inline code and
  links wrap the selected text (or the line's text). On a blank line they insert a starter snippet.

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
  4. Single-choice list (`<!-- choose: one -->`)
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
6. Comments and markers
  1. Comment for discussion (only when comments are on: Proposals)
  2. Hidden note (`<!-- -->`)
  3. Marked region (`<!-- region:name:start -->` … `:end`; renaming the start renames the end)
  4. Tag marker (`<!-- tag:name -->`)
7. Other
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
| D2 | Tool name `markode`; installed with pnpm |
| D3 | Translation done by the AI via the skill (`/markode translate`), no API key |
| D4 | Translations in `.markode/i18n/`, hidden and git-ignored |
| D5 | Base `/docs`: `architecture.md`, `rules.md`, `tasks.md`, `decisions.md`, `phases/` |
| D6 | Palette: dark by default + light theme; one hue per element type (CSS tokens in `web/src/styles.css`) |
| D7 | Changes view: `git diff` against HEAD grouped by Markdown section |
| D8 | Dashboard: phase cards (`type: phase`) with checkbox progress + documents grouped by `type` |
| D10 | Source language configurable per project (managed section of the main doc); translations per user, multiple allowed |
| D11 | Language detection: stopword heuristic, prose only; files under 25 words are not flagged |
| D12 | Sidebar search: one box with Names / Content modes; content search and replace run on the server (`/api/search`, `/api/replace`) |
| D9 | Stack: Node CLI (`src/`) + React/Vite + CodeMirror 6 web UI (`web/`), local server on port 4319 |

## 10. Next

- [ ] "Mark as reviewed" snapshot in the changes view
- [ ] Rename / move / delete files from the sidebar
- [ ] Publish to npm

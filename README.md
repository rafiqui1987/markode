# mdrules

[![CI](https://github.com/rafiqui1987/mdrules/actions/workflows/ci.yml/badge.svg)](https://github.com/rafiqui1987/mdrules/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**See and edit every Markdown file in your project in one place: no split screen, no raw syntax in the
way.**

Run `mdrules` in any repository and it opens all its `.md` files (`README.md`, `CLAUDE.md`, `AGENTS.md`,
`docs/`…) in a single editor that is also the preview. Tables, Mermaid diagrams, checklists and math
render as you type, and change in place. Files are saved exactly as written, never reformatted, so Git
diffs stay clean and AI agents keep reading plain Markdown.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshot-dark.png">
  <img alt="mdrules editor: file tree, a phase doc with checklists, an editable table, a Mermaid diagram and KaTeX math" src="docs/assets/screenshot-light.png">
</picture>

## Quick start

Requires Node.js 20 or newer. From the root of any project (monorepos included):

```bash
npx mdrules
```

The first run asks a few questions (main doc, a structure for specs, rules, languages) and opens the
editor at `http://localhost:4319`. It only listens on `127.0.0.1`.

## What it does

### 1. Every Markdown file of the project, in one place

A file tree with every `.md` in the folder where you run it, folders first. Search, expand or collapse
all, create files and folders inline, hide what you don't need (`.mdrulesignore`) and delete from the
right-click menu. Resize the sidebar by dragging its edge, or hide it for more room.

### 2. Edit and view at the same time

There is no "editor | preview" split. Markdown syntax is hidden everywhere except the line you are
editing, as in Obsidian, so you read the document as it looks and still write plain Markdown.
Undo, redo and **discard** (back to how the file was when you opened it) sit next to the breadcrumb.

### 3. Formatting without remembering syntax

- **`/` commands**: type `/` at the start of a line (or `Ctrl+Space` anywhere) for a menu of headings,
  lists, checklists, tables, code blocks, diagrams, quotes, links and frontmatter.
- **Selection toolbar**: select text to copy it or turn it into bold, italic, strikethrough, code or a
  link. Hover a button for its variants (`**`/`__`, `*`/`_`, `***`).

### 4. Diagrams, tables and lists that are easy to work with

- **Mermaid diagrams** (flowcharts, sequences…) render in place and follow the light or dark theme.
  ` ```tree ` blocks draw folder structures.
- **Tables**: edit cells directly. Right-click to insert or delete rows and columns; drag borders to
  resize columns (view only, the file is not changed).
- **Tables from Excel or Google Sheets**: paste a range of cells and it becomes a Markdown table.
  `Alt+H` toggles whether the first row is a header.
- **Checklists**: click to tick. After `Enter` on a task, `Ctrl+Enter` ticks the new one.
- And more: KaTeX math (`$x^2$`, `$$…$$`), footnotes on hover, local and remote images, code blocks with
  only their language label showing.

### 5. Plan your project with specs

`mdrules init` can set up a structure for specs and planning, which the **Dashboard** then shows with
its progress:

| Option | What you get |
|---|---|
| **mdrules** | `docs/` with phases, tasks, decisions, rules and architecture, with examples and a guide |
| **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** | `openspec/` with specs and proposed changes; the dashboard shows each change and its tasks |
| **[GitHub Spec Kit](https://github.com/github/spec-kit)** | a constitution and one folder per feature (spec → plan → tasks); the dashboard shows what each has |

For OpenSpec and Spec Kit, mdrules runs their official installer, which also adds their commands to
your AI agent (`/opsx:*`, `/speckit-*`). If it can't (Spec Kit needs [uv](https://docs.astral.sh/uv/)),
it creates a compatible structure with a guide on how to add them later. Projects that already use
either are detected and shown as they are.

### 6. Your AI agent's skills

The **Skills** tab lists every global skill you have for Claude Code, Codex, Gemini, Copilot or Cursor
([Agent Skills](https://agentskills.io) format). Tag them to group them, expand one to read or edit its
`SKILL.md`, see problems that would stop an agent from loading it, and **add it to the current project**
(`.claude/skills/` and/or `.agents/skills/`). Tags are stored in `~/.mdrules/skills.json`, never in the
skill.

### 7. Also included

- **Changes**: Git diff of your Markdown, grouped by folder and section.
- **Rules**: reusable rule presets (e.g. "ask before committing") written into `CLAUDE.md` or `AGENTS.md`.
- **Languages**: view and edit docs in English, Spanish, French, Portuguese, German or Italian while
  the files stay in one source language; the AI applies your edits with `/mdrules sync`. The interface
  is translated too.
- **Settings**: font, size, line spacing, margins, line width and wrapping; light and dark themes.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `/` at the start of a line, `Ctrl+Space` | Insert menu |
| `Ctrl+Enter` | Tick or untick the task on the current line |
| `Alt+H` | After pasting a table from a spreadsheet: toggle the header row |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+F` | Find and replace |
| `Escape` | Close a menu or the selection toolbar |

## Commands

```bash
mdrules                     # set up the project if needed, then open the editor
mdrules init                # run the setup again
mdrules serve               # open the editor without the setup
mdrules serve --port 5000 --no-open
```

To keep it installed: `npm install -g mdrules` (or `pnpm add -g mdrules`).

## For AI agents

`mdrules init` installs `.claude/skills/mdrules/SKILL.md`, which tells the agent how to write Markdown
that mdrules presents well and how to keep translations in sync. It also writes into the main doc:

- the working rules you picked, between `<!-- mdrules:rules:start -->` and `<!-- mdrules:rules:end -->`;
- how the project plans its work (mdrules, OpenSpec or Spec Kit), between
  `<!-- mdrules:workflow:start -->` and `<!-- mdrules:workflow:end -->`.

```bash
mdrules sync --status [--json]                   # translations + files not in the source language
mdrules sync --mark [--lang xx] <path...>|--all  # record translations as in sync
mdrules sync --keep <path...>                    # keep files in their current language
```

## Uninstall

```bash
npm uninstall -g mdrules    # or: pnpm remove -g mdrules (use the one you installed it with)
```

To remove it from a project, delete `.mdrules/` and `.claude/skills/mdrules/`, the `.mdrules/` line in
`.gitignore`, and the `mdrules:rules` and `mdrules:workflow` blocks in your main doc (keep the text
inside if you still want it). Editor settings, rule presets and skill tags live in `~/.mdrules`.

## Development

```bash
pnpm install
pnpm dev        # server on :4319 (this repo as root) + Vite on http://localhost:4320
pnpm build      # web → dist/web, CLI → dist/cli.js
pnpm typecheck
```

To try your local build in other projects, run `pnpm build && pnpm add -g "link:$PWD"`.

See [docs/SPEC.md](docs/SPEC.md) for the specification and [CONTRIBUTING.md](CONTRIBUTING.md) to
contribute.

## License

[MIT](LICENSE)

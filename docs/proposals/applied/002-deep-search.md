---
type: proposal
status: applied
updated: 2026-10-25
affects: [docs/SPEC.md, web/src/components/Sidebar.tsx, src/server/index.ts, web/src/i18n.ts]
---

# Proposal: deep search in the sidebar (search inside files, VS Code style)

## Context

Today the sidebar search only filters the tree by **file path** (`filterTree` in `Sidebar.tsx`). The
goal is to also find text **inside** every `.md` file of the project, as VS Code's "Search" view does:
results grouped by file, each matching line with the match highlighted, and a click opens the file
on that line.

All options share the same core:

```text
 sidebar input ──debounce 200ms──▶ GET /api/search?q=…&case&word&regex
                                        │  server: flattenFiles(tree) → read each .md → match per line
                                        ▼
 { file, matches: [{ line, col, len, preview }] }[]   (capped: 200 files / 2000 matches)
                                        │
                                        ▼
 ▼ docs/SPEC.md                     3     click a line → open file, select the match,
     171  - **Sidebar**: tree of …         scroll it into view (reuses the editor's
     287  - [ ] Rename / move / …          search highlight)
 ▶ CLAUDE.md                        1
```

- Search runs on the server (it already has the file list and respects `.markodeignore`), so the
  browser doesn't load every file.
- Ignored files and archived proposals are left out unless "show ignored" is on.
- With a second language enabled, it searches the files shown in the current language.
- Options in the input, like VS Code: match case, whole word, regex (same icons as the editor's
  search panel, `searchPanel.ts`).

## Option A: one input, two modes in the same box (recommended)

```text
 FILES                      [+][+][o][^][Q]
 ┌───────────────────────────────────────┐
 │ Q  auth token          [Aa][ab][.*]   │
 └───────────────────────────────────────┘
   ( Names )  (*Content*)      12 in 4 files
 ─────────────────────────────────────────
 ▼ docs/architecture/auth.md          5
     12  Each **token** expires after …
 ▶ docs/tasks/T-004-login.md          2
```

- The current search box stays; a small toggle switches between "Names" (today's tree filter) and
  "Content" (grouped results). The last mode is remembered.
- Shortcut: `Ctrl+Shift+F` opens it directly in "Content" mode with the selected text from the editor.
- Pros: no new panel, keeps the sidebar simple, both searches one click apart.
- Cons: the tree is replaced by the results while in "Content" mode.

## Option B: separate "Search" view, as VS Code's activity bar

```text
 [Files] [Search]
 ┌──────────────────────────┐
 │ Q  auth token  [Aa][ab][.*]│
 │ > files to include: docs/  │
 └──────────────────────────┘
 ▼ docs/architecture/auth.md  5
```

- Two tabs on top of the sidebar; the file tree and its filter stay as they are.
- Room for "files to include / exclude" globs later.
- Cons: more UI, and the existing name filter and the new view overlap.

## Option C: command palette (`Ctrl+P` / `Ctrl+Shift+F`) instead of the sidebar

- A floating dialog with results, like Spotlight; the sidebar doesn't change.
- Cons: results disappear when you open one, so you can't walk through them one by one.

## Your choice

<!-- choose: one -->
- [x] A: one input, two modes in the same box
- [ ] B: separate "Search" view
- [ ] C: command palette

## Also include

- [x] Match case / whole word / regex toggles
- [x] `Ctrl+Shift+F` shortcut (prefilled with the editor's selection)
- [x] Search in frontmatter too (by default it is skipped)
- [x] Replace in all files (with preview and confirmation; respects "never reformat a user's file")
- [x] Search the rendered text (ignore Markdown syntax like `**`, links' URLs, HTML comments)
- [x] Files to include / exclude filter (globs)

## After your answer

- A: add `GET /api/search` in `src/server/index.ts` (matching in a new `src/core/search.ts`), a mode
  toggle and grouped results in `Sidebar.tsx`, an `onOpen(path, { line, col, len })` that selects the
  match in the editor, i18n keys in en/es/fr, and update the Sidebar section of `docs/SPEC.md`.
- B: same server side, plus a `SearchView.tsx` component and tabs in the sidebar header.
- C: same server side, plus a modal component in `App.tsx`.
- Ticked extras are built in the same change; "Replace in all files" goes in a second step.

## Open questions

1. Results refresh while files change (the websocket watcher already notifies edits)?

   <!-- choose: one -->
   - [x] Yes, re-run the search when a file changes
   - [ ] No, only when the query changes

---
type: proposal
status: applied
updated: 2026-10-28
affects: [docs/SPEC.md, templates/skill/SKILL.md, CLAUDE.md]
---

# Proposal: translation engines (browser and local LLM)

## Context

Today a translation only happens when the user runs `/markode translate`: the AI agent rewrites whole
files into `.markode/i18n/<lang>/`, and `state.json` keeps one hash per file. It needs an agent session,
costs tokens, and a one-line change re-translates the whole file. The goal: keep choosing the interface
language and the docs' languages, but let markode translate by itself with the **browser** (Chrome's
built-in Translator API, on-device) or a **local LLM** through Ollama (e.g. `gemma3:4b`).

What stays as it is: the source language, the translation languages, `.markode/i18n/` (git-ignored),
the sidebar always in the source tree, and the rule that the source file is never overwritten without
the user's approval.

## Option A: one segment pipeline, pluggable engines (recommended)

markode splits a file into **segments** (heading, paragraph, list item, table cell, blockquote line) and
only sends prose to the engine. Code blocks, frontmatter, comments, inline code, link targets and
markode markers are kept byte for byte. Each translated segment is cached by the hash of its source
text, so editing one paragraph re-translates one paragraph.

```text
 source.md ──split──▶ segments ──cache hit?──yes──▶ reuse
                          │                  no
                          ▼                   │
                  kept as is (code,           ▼
                  frontmatter, URLs)   ┌─ engine ──────────────┐
                          │            │ browser  (Translator) │
                          │            │ ollama   (gemma3:4b)  │
                          │            │ agent    (the skill)  │
                          │            └───────────┬───────────┘
                          ▼                        ▼
                     join, same layout ──▶ .markode/i18n/<lang>/source.md
```

- **Browser**: runs in the markode tab (Chrome/Edge 138+, desktop). Free, offline once the language
  pair model is downloaded, fast; plain translation quality, no glossary. Firefox and Safari don't have
  it: the option is greyed out there.
- **Ollama**: the server calls `http://localhost:11434` (URL and model in Settings). Better with
  technical wording and can follow a glossary ("never translate: skill, frontmatter, markode"). Slower on
  CPU; a 4B model is fine per segment, unreliable on whole files, which is why segments matter. Worth
  trying `translategemma:4b` next to `gemma3:4b`.
- **Agent**: `/markode translate` keeps working, now fed the same segments (fewer tokens).
- Pros: one storage and one cache for every engine, incremental, the Markdown never breaks.
- Cons: the most work (splitter + join + cache); a sentence split across a list may read slightly off.

## Option B: whole file to the engine

Send the full file with a "keep the Markdown as is" prompt; keep one hash per file as today.

- Pros: little code, same `state.json`.
- Cons: the browser API is plain text, so it breaks the Markdown (no browser engine in practice); a 4B
  model drops lines, translates code and rewrites tables; every small change re-translates the file.

## Option C: translate on the fly, nothing stored

The translation is made when a file is opened, kept only in a browser cache; no `.markode/i18n/` files.

- Pros: the cleanest model, no sync states at all.
- Cons: translations can no longer be edited and synced back (`pending-sync`); the agent can't read
  them; it depends on the browser being open.

## Your choice

<!-- choose: one -->
- [x] A: segment pipeline with pluggable engines (browser, Ollama, agent)
- [ ] B: whole file to the engine
- [ ] C: translate on the fly, nothing stored

## Also include

- [x] Glossary per project (`.markode/glossary.json`): terms never translated or with a fixed translation
- [x] Use Chrome's Language Detector API, when there, instead of the stopword heuristic (D11)
- [x] Interface in any language: generate the UI strings for a language not built in with the chosen engine (cached in `~/.markode/`)
- [x] `markode translate --engine ollama` in the CLI, to translate without the editor open

## After your answer

- **A**: update SPEC §4 (engines, segments, cache, settings) and decisions D3/D4; add `engine`,
  `ollamaUrl`, `ollamaModel` to Settings → Languages; build `src/core/segments.ts` (split/join with
  tests on CLAUDE.md, tables and code blocks), the segment cache in `state.json`, the Ollama client on
  the server, the browser engine in `web/src/`; adapt the `markode` skill so `/markode translate` uses
  the segments.
- **B**: Ollama only, whole file; update SPEC §4 and D3; the browser option is dropped.
- **C**: rewrite SPEC §4 without storage or sync states, remove `.markode/i18n/` handling and
  `pending-sync`, update the skill.

## Open questions

1. When does markode translate with a local engine?

   <!-- choose: one -->
   - [x] Automatically in the background when a source file changes (recommended: with the cache it is only the changed segments)
   - [ ] Only when opening a file in a translation language
   - [ ] Only on a "Translate" button, like today's command

2. Editing a translation (today `pending-sync`, synced back by the AI): what then?

   <!-- choose: one -->
   - [x] The engine translates the edited segments back and markode shows the change to the source for approval (recommended)
   - [ ] Keep it as today: only the agent syncs edits back
   - [ ] Translations become read-only

3. Default engine for a new project?

   <!-- choose: one -->
   - [x] Browser when available, otherwise the agent (recommended: works with nothing installed)
   - [ ] Ollama
   - [ ] Agent, as today

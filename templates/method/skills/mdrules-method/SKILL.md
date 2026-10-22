---
name: mdrules-method
description: Where each kind of project knowledge goes in the mdrules method (vision, architecture, phases, tasks), when to create each doc, and templates for them. Use before creating, moving or growing a doc under docs/, or when a decision, a goal or a milestone needs writing down.
---

# The mdrules method

The docs are a **map and a memory**, not an encyclopedia. Write only what nobody can learn from the
code: decisions and their reasons, conventions that aren't visible, and the state of the work. The main
doc (`CLAUDE.md` or `AGENTS.md`) is the map: it says where things are, never what they say.

## Where things go

| What | Where | Create it when |
|---|---|---|
| Vision | `docs/vision.md` | the user says what the project is for, for whom, or what is out of scope |
| Shared architecture | `docs/architecture/<topic>.md` | a technology or design decision affects the whole repository (or several projects) |
| Architecture of one project (monorepo) | `<project>/docs/ARCHITECTURE.md` | a decision affects only that project |
| Phases | `docs/phases/NN-name.md` | the user plans a milestone made of several tasks |
| Tasks | `docs/tasks/<ID>-slug.md`, or `<project>/docs/tasks/` in a monorepo | the user asks for one (`/mdrules-new-task`) |

A task's status lives only in its frontmatter: there is no index to keep in sync. `/mdrules-status` and
the mdrules Dashboard list tasks by status.

To create one, copy its template from `templates/` next to this file (`vision.md`,
`architecture-topic.md`, `project-architecture.md`, `phase.md`), replace the `<placeholders>` and set
`updated` to today. When `docs/architecture/` gets a second file, add a `README.md` there with one line
per file.

## By kind of project

The main doc says what kind of project this is ("This project", or the "Kind" column of the "Projects"
table) and where that kind's docs go. Follow it; these are the usual ones:

| Kind | Docs it needs (created when there is something to write) |
|---|---|
| App | vision, architecture by topic, phases |
| Library / package | public API and versioning (`docs/architecture/api.md`); `CHANGELOG.md` if published; phases only for planned milestones |
| Microservices | contracts (APIs, events) as shared architecture (`docs/architecture/contracts.md`); a contract change gets a task in every consumer |
| Mobile app | release and store decisions (`docs/architecture/releases.md`) |
| Data / ML | datasets: source, location, schema (`docs/architecture/data.md`); an experiment log |
| Infrastructure | environments, one runbook per operation (`docs/runbooks/`) |

If the main doc lists "Existing docs", they are the official ones: update them instead of creating
new docs that would repeat them.

## What not to write

- What the code already says: folder listings, dependency lists, what a function does.
- Generic advice ("write clean code", "handle errors properly").
- The same fact twice: link to the one place where it lives.
- Empty sections or docs "to fill later": create a doc when there is something real to put in it.
- Decisions or task lists in the main doc: it only points to them.

## Task statuses

| status | meaning |
|---|---|
| `pending` | defined, not started |
| `in-progress` | being worked on; a new session resumes from its "Next step" |
| `blocked` | waiting on something; "Next step" says what |
| `done` | every acceptance criterion is met |

## Phases

- A phase lists its tasks as a checklist; tick a task there when it becomes `done`.
- `status: in-progress` when its first task starts; `done` when every task and every item of
  "Definition of done" is ticked.

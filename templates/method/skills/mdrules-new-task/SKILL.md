---
name: mdrules-new-task
description: Creates a task file in this project's docs (the mdrules method) when the user asks for a new task. Uses the task template, the next ID of the area, and updates the task index and the phase.
---

# New task (mdrules method)

Create tasks only when the user asks; you may propose them first.

1. Gather what is missing, in one question: title, goal, area (in a monorepo, the project: the "Projects"
   table in the root main doc lists them and their prefixes), phase, and dependencies.
2. Folder and prefix: the area's `docs/tasks/` with its prefix; cross-area or single-project tasks go
   in the root `docs/tasks/` (prefix in the root `docs/TASKS.md` title, `T` by default).
3. Next ID: the highest `<PREFIX>-NNN` in that folder + 1, three digits.
4. Copy the root `docs/tasks/_TEMPLATE.md` to `<folder>/<ID>-<short-slug>.md`. Fill the frontmatter
   (`id`, `status: pending`, `area`, `phase`, `depends`, `created` and `updated` = today), the title,
   the goal and the acceptance criteria as a checklist.
5. Add `- [<ID>](tasks/<file>.md) <title>` under "Pending" in that folder's `TASKS.md`. For a
   cross-area task, also link it from each affected area's `TASKS.md`; never copy it.
6. If it belongs to a phase, add `- [ ] [<ID>](<relative path>) <title>` under "Tasks" in
   `docs/phases/NN-*.md`.
7. Show the task to the user. Do not start working on it until they say so.

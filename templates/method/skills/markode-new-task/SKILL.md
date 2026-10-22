---
name: markode-new-task
description: Creates a task file in this project's docs (the markode method) when the user asks for a new task. Uses the task template and the next ID of the project, and adds the task to its phase.
---

# New task (markode method)

Create tasks only when the user asks; you may propose them first.

1. Gather what is missing, in one question: title, goal, project (in a monorepo: the "Projects" table
   in the root main doc lists them and their prefixes), phase, and dependencies.
2. Folder and prefix: the project's `docs/tasks/` with its prefix; tasks across projects, or in a
   single project, go in the root `docs/tasks/` with the prefix the root main doc gives (`T` by default).
3. Next ID: the highest `<PREFIX>-NNN` in that folder + 1, three digits.
4. Copy the root `docs/tasks/_TEMPLATE.md` to `<folder>/<ID>-<short-slug>.md`. Fill the frontmatter
   (`id`, `status: pending`, `area`, `phase`, `depends`, `created` and `updated` = today), the title,
   the goal and the acceptance criteria as a checklist. The frontmatter is the only place the status
   lives: there is no task index to update.
5. If it belongs to a phase, add `- [ ] [<ID>](<relative path>) <title>` under "Tasks" in
   `docs/phases/NN-*.md` (create the phase from the `markode-method` template if the user is planning
   a new one).
6. Show the task to the user. Do not start working on it until they say so.

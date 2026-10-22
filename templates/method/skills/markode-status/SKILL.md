---
name: markode-status
description: Summarizes where the work stands in a project that follows the markode method - what was touched last, what is in progress, blocked and pending - grouped by project in a monorepo. Use when the user asks what is pending, where things stand, what is left, or what was done last time.
---

# Status (markode method)

Answer from the task files, not by exploring the code.

1. **Task folders**: `docs/tasks/` and, in a monorepo, each `<project>/docs/tasks/` from the "Projects"
   table of the root main doc. Read only each file's frontmatter (`id`, `status`, `phase`, `depends`,
   `updated`) and its title; skip `_TEMPLATE.md`. For example:
   `grep -H -E "^(id|status|phase|depends|updated):|^# " docs/tasks/*.md apps/*/docs/tasks/*.md`
2. **Last session**: the tasks with the most recent `updated`. If git is available, also
   `git log --since=<that date> --name-only --format="%h %s"` to see which projects changed, including
   changes no task covers.
3. **Next steps**: for `in-progress` and `blocked` tasks only, read their "Next step" section.
4. **Answer** in this order, grouped by project (shared work first), one line per task:
   - **Last session**: the projects and tasks touched.
   - **In progress**: `ID · title` — next step.
   - **Blocked**: `ID · title` — what it waits on.
   - **Pending**: how many; list the next ones (lowest phase first) whose `depends` are all `done`.
   - **Without a task**: recent changes no task covers, if any.
5. Don't open other docs unless the user asks to go deeper. End by asking which task to continue.

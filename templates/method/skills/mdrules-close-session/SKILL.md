---
name: mdrules-close-session
description: Closes a work session in a project that follows the mdrules method, recording what was done and the next step of every task touched, and updating phases.
---

# Close the session (mdrules method)

1. Identify the tasks worked on in this session.
2. For each one, in its file:
   - Add a log entry at the top of "Log": date, what was done, key files and decisions.
   - Rewrite "Next step" in one or two actionable lines (for `blocked`: what it waits on).
   - Tick the acceptance criteria that are met; set `status` and `updated` in the frontmatter.
3. If a task is `done`, tick it in its phase (`docs/phases/NN-*.md`). When every task and every item
   of "Definition of done" is ticked, set the phase to `status: done`; when the first task starts,
   set it to `in-progress`. Update `updated`.
4. If an architecture decision was made or changed, update it in its one place (the project's
   `docs/ARCHITECTURE.md` or the root `docs/architecture/`; create it from the `mdrules-method`
   templates if it doesn't exist yet), never in the main doc.
5. Run `/mdrules sync` (the docs check of the `mdrules` skill) and fix what it reports.
6. Summarize for the user in three lines: what was done, the next step, and anything open.

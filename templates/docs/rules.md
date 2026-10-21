---
type: rules
status: in-progress
updated: {{date}}
---

# Rules

Conventions the team and the AI follow. Keep each rule short and testable.

| id | rule | why |
|---|---|---|
| R1 | Example: every public function has a test | regressions show up in CI, not in production |
| R2 | Example: no secrets in the repo; use `.env` | the repo may become public |

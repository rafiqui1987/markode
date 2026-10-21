---
type: decision
status: in-progress
updated: {{date}}
---

# Decisions

One row per decision, newest last. Write the reason, not just the choice: future you (and the AI)
will need it to know when the decision no longer applies.

| id | date | decision | reason | alternatives |
|---|---|---|---|---|
| D1 | {{date}} | Example: use PostgreSQL | relational data, team knows it | SQLite (no concurrent writes), MongoDB |

## Bigger decisions

For a decision that needs more than a row, add a section and link it from the table:

### D2: Example title

- **Context**: what forced the decision.
- **Decision**: what was chosen.
- **Consequences**: what gets easier, what gets harder.

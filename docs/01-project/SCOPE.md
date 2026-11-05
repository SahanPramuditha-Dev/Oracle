# ORACLE planning questions and scope decisions

## Status

Scope is not finalized. Earlier delivery bands, release labels and schedules were suggestions and are not commitments. The user has requested a zero-cost first version and documentation needed to begin development. The new start pack proposes a small first version without committing the full feature inventory.

## Decisions to make

- Who is the first version for, and what main problem should it solve?
- Which three to five connected scenarios best demonstrate that purpose?
- Which general assistant commands and computer actions matter most?
- Which camera capabilities are essential?
- What should ORACLE remember, and when should it ask to save information?
- Are maps essential to the first version or an addition afterward?
- Which ideas should be kept for later?
- What laptop, phone, time and budget are available?
- What does the university require for research, model training and evaluation?
- What data can be collected with appropriate permission?

## Working decision table

| Decision | Current position |
|---|---|
| Main user and problem | To decide |
| First demonstration scenarios | Proposed text actions, camera reading and approved memory, then push to talk |
| Must have features | To decide |
| Optional and later features | To decide |
| Platform and hardware | Existing Windows laptop and local browser proposed; specifications to record |
| Research contribution | To discuss with supervisor |
| Timeline and resources | To confirm |
| Technology stack | React and FastAPI implemented; PostgreSQL through SQLAlchemy/Alembic now active. Ollama integration deferred. |
| Budget | Zero paid services or additional hardware for the first version, as requested |

## Next planning activity

Review the feature and scenario lists together. Mark each chosen idea as must have, optional, later or remove. Use the [development phases](../DEVELOPMENT_PHASES.md) and [readiness checklist](../DEVELOPMENT_READINESS.md) for the proposed first slice. Re-estimate once hardware, weekly availability and university requirements are known.

## Full-scope audit — 4 November 2026

The implemented phase plan was a narrow first prototype, not an allocation of every original scenario. Do not equate Phase 7 with completion of ORACLE. [The full-scope audit](../FULL_SCOPE_AUDIT.md) preserves and classifies all consolidated features and scenario entries, identifies missing modules and proposes continuation streams. No full-release scope, deadline or fixed count of remaining phases has yet been agreed. Nothing is removed from the inventory by being outside the first prototype.

# Matching

Status: the ranking engine (PRD §39–§49) is DEFERRED by the locked scope (grill G3) — the outreach core shipped first. What exists today:

- Taxonomy normalization (titles/skills/locations, India-weighted aliases) with `titleSimilarity` — used by ingestion and search.
- Search relevance: Postgres FTS rank + word-trigram typo tolerance, freshness as the no-query sort. Honest freshness labels per PRD §34.
- Behaviour signals (IMPRESSION/OPEN/SAVE/HIDE/APPLY/CONTACT) recorded from day one — the training corpus accumulates before any model exists.

Next session (per TICKETS deferrals): DB-backed taxonomy + job_skills/profile_skills joins, the pure MatchingEngine (weights per PRD §40, hard-requirement gating, banded display + deterministic explanations), Discover feed sections, and match recompute triggers. `SEMANTIC_MATCHING` stays a flag with a lexical default until then.

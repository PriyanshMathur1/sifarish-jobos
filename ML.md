# ML

Per PRD §6/§54: no generative AI anywhere, and no learning-to-rank until sufficient interaction data exists. Nothing in this build trains or serves a model. The groundwork that IS in place: append-only user_job_events, application_events with outcomes, and versioned job snapshots — the future training joins. When data volume justifies it, follow PRD §142's shadow-deploy process; the deterministic baseline must remain permanently (PRD §155).

# Data sources

All sources are public, first-party, unauthenticated. No LinkedIn, no Indeed, no CAPTCHA bypass, no login walls (PRD §5/§23).

| Provider       | Endpoint                                                     | Notes                                                                                            |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| greenhouse     | boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true | published for embedding                                                                          |
| lever          | api.lever.co/v0/postings/{site}?mode=json                    | published for embedding                                                                          |
| ashby          | api.ashbyhq.com/posting-api/job-board/{name}                 | published for embedding                                                                          |
| generic-jsonld | any careers URL                                              | STRICT schema.org JobPosting JSON-LD only; robots.txt honoured; page without JSON-LD ⇒ zero jobs |

Contact discovery (flagged, CONTACT_DISCOVERY): schema.org Person JSON-LD from company-owned pages only, robots honoured, provenance stored on every record, suppression list honoured at discovery AND at send.

Seed registry: 18 companies (see packages/db/src/seed-data.ts), India-weighted, admin-editable. Market filter (MARKET_COUNTRIES=IN) applies at ingest: jobs located in India, or remote-and-India-eligible (APAC counts), are kept; unstated-region remote is kept but badged "eligibility unverified"; the rest are counted and discarded.

Freshness honesty (PRD §34): "Posted" only when the source stated a date; otherwise "Discovered" from Sifarish's own first observation. Never fabricated.

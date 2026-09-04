# Privacy

- The user can: delete their account (cascades all data, audited), disconnect Gmail (tokens deleted, not flagged), suppress any contact (hidden + hashed into the suppression list so sending and rediscovery are blocked).
- Contact data is professional-only: name, title, company, work email, public profile URL. No home addresses, no personal phones (PRD §110). Every contact carries provenance (who added it / which public page it came from, and when).
- Suppression stores a SHA-256 of the email, not the address itself.
- Resumes (when the upload path lands in a later phase) are private objects, never public.
- Behaviour events (save/hide/open/apply/contact) exist to serve the user's own ranking and are deleted with the account.

## Gmail permissions (Autopilot)

- Default: `gmail.compose` only. Sifarish can create drafts in the user's mailbox and nothing else.
- With `OUTREACH_DIRECT_SEND=true` (campaigns): `gmail.send` so approved campaigns go out from the user's own address, and `gmail.metadata` so Sifarish can read message **headers only** (From, Subject, Date, labels) on threads it started, to detect replies and bounces. It never requests a scope that exposes message bodies, and it only fetches threads whose id it recorded at send time.
- Tokens stay AES-256-GCM encrypted at rest; disconnecting deletes them.
- Every campaign message carries a plain-text unsubscribe line; a bounce marks the address INVALID and the sequence stops.

## Resumes and answers

- Resumes are stored in the database as private bytes, downloadable only by their owner (and the apply runner acting with that owner's device token). The answer bank is private to the user in the same way.
- The apply runner runs on the user's own computer, in their own browser, with their own identity. Sifarish never submits an application on a user's behalf from its servers.

## LinkedIn

- The only LinkedIn data Sifarish ever handles is the user's own connections export, uploaded by the user. Sifarish does not crawl, scrape, or automate LinkedIn.

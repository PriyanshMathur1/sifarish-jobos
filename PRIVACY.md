# Privacy

- The user can: delete their account (cascades all data, audited), disconnect Gmail (tokens deleted, not flagged), suppress any contact (hidden + hashed into the suppression list so sending and rediscovery are blocked).
- Contact data is professional-only: name, title, company, work email, public profile URL. No home addresses, no personal phones (PRD §110). Every contact carries provenance (who added it / which public page it came from, and when).
- Suppression stores a SHA-256 of the email, not the address itself.
- Resumes (when the upload path lands in a later phase) are private objects, never public.
- Behaviour events (save/hide/open/apply/contact) exist to serve the user's own ranking and are deleted with the account.

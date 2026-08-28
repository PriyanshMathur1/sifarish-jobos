// NOTE: migrate.ts is intentionally NOT re-exported — it resolves the
// migrations folder from disk, which must not be bundled into the web app.
// Import it directly (`@jobos/db/migrate`) from scripts and tests.
export { getDb, closeDb, schema, type Db } from "./client.ts";
export * from "./schema/index.ts";
export * as usersRepo from "./repo/users.ts";
export * as profilesRepo from "./repo/profiles.ts";
export { audit } from "./repo/audit.ts";
export * as jobsRepo from "./repo/jobs.ts";

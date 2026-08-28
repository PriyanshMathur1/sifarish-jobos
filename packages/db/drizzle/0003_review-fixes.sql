-- Orphaned events (from users deleted before the FK existed) must go first.
DELETE FROM "user_job_events" WHERE "user_id" NOT IN (SELECT id FROM "users");--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_runs" ADD COLUMN "companies_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_job_events" ADD CONSTRAINT "user_job_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
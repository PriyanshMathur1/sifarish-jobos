CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"domain" text,
	"careers_url" text,
	"ats_provider" text,
	"ats_identifier" text,
	"industry" text,
	"company_size" text,
	"hq" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"detection_confidence" text,
	"last_checked_at" timestamp with time zone,
	"last_successful_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_errors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"company_id" uuid,
	"provider" text,
	"stage" text NOT NULL,
	"error" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"is_primary" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_provider" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"title_function" text,
	"seniority" text DEFAULT 'mid' NOT NULL,
	"description_html" text,
	"description_text" text,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remote_type" text,
	"market_eligibility" text NOT NULL,
	"employment_type" text,
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"salary_period" text,
	"apply_url" text,
	"source_url" text,
	"source_posted_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"content_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(normalized_title,'') || ' ' || coalesce(description_text,''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"trigger" text DEFAULT 'cron' NOT NULL,
	"companies_processed" integer DEFAULT 0 NOT NULL,
	"jobs_new" integer DEFAULT 0 NOT NULL,
	"jobs_updated" integer DEFAULT 0 NOT NULL,
	"jobs_removed" integer DEFAULT 0 NOT NULL,
	"jobs_rejected_market" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_job_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawl_errors" ADD CONSTRAINT "crawl_errors_run_id_refresh_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."refresh_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_errors" ADD CONSTRAINT "crawl_errors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_versions" ADD CONSTRAINT "job_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_job_events" ADD CONSTRAINT "user_job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_ats_uq" ON "companies" USING btree ("ats_provider","ats_identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_domain_uq" ON "companies" USING btree ("normalized_name","domain");--> statement-breakpoint
CREATE INDEX "crawl_errors_company_idx" ON "crawl_errors" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_uq" ON "job_sources" USING btree ("provider","external_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_versions_uq" ON "job_versions" USING btree ("job_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_company_provider_external_uq" ON "jobs" USING btree ("company_id","source_provider","external_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_first_seen_idx" ON "jobs" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "jobs_search_idx" ON "jobs" USING gin ("search");--> statement-breakpoint
CREATE INDEX "user_job_events_user_idx" ON "user_job_events" USING btree ("user_id","type");
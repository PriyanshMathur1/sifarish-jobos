CREATE TABLE "apply_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"reason" text DEFAULT 'band' NOT NULL,
	"mode" text DEFAULT 'confirm' NOT NULL,
	"form_url" text,
	"provider" text,
	"resume_id" uuid,
	"blocker" text,
	"blocker_question" text,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"screenshot" "bytea",
	"error" text,
	"runner_name" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_rules" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"auto_queue_band" text DEFAULT 'strong' NOT NULL,
	"queue_saved" boolean DEFAULT true NOT NULL,
	"daily_cap" integer DEFAULT 10 NOT NULL,
	"mode" text DEFAULT 'confirm' NOT NULL,
	"max_age_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "apply_attempts" ADD CONSTRAINT "apply_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_attempts" ADD CONSTRAINT "apply_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_attempts" ADD CONSTRAINT "apply_attempts_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_rules" ADD CONSTRAINT "apply_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apply_attempts_user_job_uq" ON "apply_attempts" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "apply_attempts_user_status_idx" ON "apply_attempts" USING btree ("user_id","status");
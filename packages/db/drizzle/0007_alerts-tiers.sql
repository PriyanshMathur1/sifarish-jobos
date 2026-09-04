CREATE TABLE "alert_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"instant_enabled" boolean DEFAULT true NOT NULL,
	"instant_min_band" text DEFAULT 'strong' NOT NULL,
	"digest_enabled" boolean DEFAULT true NOT NULL,
	"digest_min_band" text DEFAULT 'good' NOT NULL,
	"digest_hour" integer DEFAULT 9 NOT NULL,
	"telegram_chat_id" text,
	"last_digest_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_preferences" ADD CONSTRAINT "alert_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_user_job_instant_uq" ON "alerts" USING btree ("user_id","job_id","kind");--> statement-breakpoint
CREATE INDEX "alerts_user_idx" ON "alerts" USING btree ("user_id","sent_at");
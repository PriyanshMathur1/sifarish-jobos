CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'QUEUED' NOT NULL,
	"next_at" timestamp with time zone,
	"root_message_id" uuid,
	"last_message_id" uuid,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"job_id" uuid,
	"steps" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"daily_cap" integer DEFAULT 40 NOT NULL,
	"spacing_sec" integer DEFAULT 120 NOT NULL,
	"pause_reason" text,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text DEFAULT 'team' NOT NULL,
	"url" text NOT NULL,
	"last_discovered_at" timestamp with time zone,
	"last_found" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "gmail_message_id" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "rfc_message_id" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_root_message_id_outreach_messages_id_fk" FOREIGN KEY ("root_message_id") REFERENCES "public"."outreach_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_last_message_id_outreach_messages_id_fk" FOREIGN KEY ("last_message_id") REFERENCES "public"."outreach_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_pages" ADD CONSTRAINT "company_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_uq" ON "campaign_recipients" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_due_idx" ON "campaign_recipients" USING btree ("user_id","state","next_at");--> statement-breakpoint
CREATE INDEX "campaigns_user_idx" ON "campaigns" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_pages_uq" ON "company_pages" USING btree ("company_id","url");--> statement-breakpoint
CREATE INDEX "outreach_campaign_idx" ON "outreach_messages" USING btree ("campaign_id");
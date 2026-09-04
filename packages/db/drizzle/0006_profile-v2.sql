CREATE TABLE "answer_bank" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question_text" text NOT NULL,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "portfolio_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "current_location" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "notice_period_days" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "current_ctc_lpa" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "expected_ctc_lpa" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "work_authorization" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "willing_to_relocate" boolean;--> statement-breakpoint
ALTER TABLE "answer_bank" ADD CONSTRAINT "answer_bank_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_bank_user_key_uq" ON "answer_bank" USING btree ("user_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_user_label_uq" ON "resumes" USING btree ("user_id","label");
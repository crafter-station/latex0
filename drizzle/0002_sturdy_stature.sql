CREATE TABLE "project_shares" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"project_id" varchar(21) NOT NULL,
	"shared_by" text NOT NULL,
	"shared_with" text,
	"permission" text NOT NULL,
	"share_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_shares_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"parent_id" varchar(21),
	"user_id" text NOT NULL,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"color" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "project_id" varchar(21);--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "project_id" varchar(21);
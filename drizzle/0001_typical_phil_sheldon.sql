CREATE TABLE "document_shares" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"document_id" varchar(21) NOT NULL,
	"shared_by" text NOT NULL,
	"shared_with" text,
	"permission" text NOT NULL,
	"share_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_shares_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"document_id" varchar(21) NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"content_type" text NOT NULL,
	"title" text NOT NULL,
	"trigger_type" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_from" integer,
	CONSTRAINT "unique_doc_version" UNIQUE("document_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"parent_id" varchar(21),
	"user_id" text NOT NULL,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "folder_id" varchar(21);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;
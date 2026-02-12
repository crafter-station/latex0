CREATE TABLE "documents" (
	"id" varchar(21) PRIMARY KEY NOT NULL,
	"title" varchar(255) DEFAULT 'Untitled Document' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"folder" varchar(255) DEFAULT 'root' NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

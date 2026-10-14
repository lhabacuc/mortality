ALTER TABLE "client_grants" ADD COLUMN "blocked_dirs" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_grants" ADD COLUMN "allow_all_dirs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "allow_all_dirs_ok" boolean DEFAULT true NOT NULL;
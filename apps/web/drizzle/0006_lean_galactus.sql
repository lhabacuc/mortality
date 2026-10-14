ALTER TABLE "users" ALTER COLUMN "max_preset" SET DEFAULT 'sudo_for_all';
--> statement-breakpoint
UPDATE "users" SET "max_preset" = 'sudo_for_all', "allow_all_dirs_ok" = true;

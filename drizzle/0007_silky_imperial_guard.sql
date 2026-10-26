CREATE TABLE `ai_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature` text NOT NULL,
	`model` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`subject` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micros` integer,
	`cost_estimated` integer DEFAULT false NOT NULL,
	`error_kind` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `ai_runs_started_idx` ON `ai_runs` (`started_at`);
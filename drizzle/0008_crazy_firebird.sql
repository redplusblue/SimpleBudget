CREATE TABLE `ai_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text NOT NULL,
	`subject_key` text,
	`payload_json` text NOT NULL,
	`preview_json` text,
	`confidence` text,
	`model` text,
	`ai_run_id` integer,
	`thread_id` integer,
	`rule_id` integer,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_proposals_status_idx` ON `ai_proposals` (`kind`,`status`);--> statement-breakpoint
CREATE INDEX `ai_proposals_subject_idx` ON `ai_proposals` (`subject_key`);
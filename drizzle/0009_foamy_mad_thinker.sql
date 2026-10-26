CREATE TABLE `ai_insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch` integer NOT NULL,
	`lens` text NOT NULL,
	`model` text,
	`ai_run_id` integer,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`fact_ids_json` text NOT NULL,
	`link` text,
	`pinned` integer DEFAULT false NOT NULL,
	`dismissed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_insights_batch_idx` ON `ai_insights` (`batch`);--> statement-breakpoint
CREATE TABLE `ai_memories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text,
	`ai_run_id` integer,
	`tools_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `ai_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_messages_thread_idx` ON `ai_messages` (`thread_id`,`id`);--> statement-breakpoint
CREATE TABLE `ai_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`lens` text DEFAULT 'general' NOT NULL,
	`summary` text,
	`summary_up_to` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

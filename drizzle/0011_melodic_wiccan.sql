CREATE TABLE `automation_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automation_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`dedupe_key` text,
	`ai_run_id` integer,
	`preview` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_runs_auto_idx` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger_json` text NOT NULL,
	`action_json` text NOT NULL,
	`destination_id` integer NOT NULL,
	`model` text,
	`include_details` integer DEFAULT false NOT NULL,
	`last_run_at` integer,
	`last_status` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`destination_id`) REFERENCES `notify_destinations`(`id`) ON UPDATE no action ON DELETE no action
);

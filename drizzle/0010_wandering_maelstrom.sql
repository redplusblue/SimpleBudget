CREATE TABLE `notify_destinations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url_enc` text NOT NULL,
	`token_enc` text,
	`created_at` integer NOT NULL
);

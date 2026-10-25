CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`account_id` text NOT NULL,
	`target_cents` integer NOT NULL,
	`start_cents` integer DEFAULT 0 NOT NULL,
	`target_date` text,
	`color` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`sf_id` text NOT NULL,
	`symbol` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`shares` text DEFAULT '0' NOT NULL,
	`market_value_cents` integer NOT NULL,
	`cost_basis_cents` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_account_sf_unique` ON `holdings` (`account_id`,`sf_id`);
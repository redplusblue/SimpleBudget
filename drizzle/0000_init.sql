CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` integer,
	`org_name` text NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`balance_cents` integer DEFAULT 0 NOT NULL,
	`available_cents` integer,
	`balance_date` integer,
	`display_name` text,
	`type` text DEFAULT 'other' NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`is_closed` integer DEFAULT false NOT NULL,
	`exclude_from_net_worth` integer DEFAULT false NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`balance_cents` integer NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer,
	`tag_id` integer,
	`month` text,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`group_name` text,
	`color` text NOT NULL,
	`icon` text,
	`is_income` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_name` text NOT NULL,
	`org_domain` text,
	`sfin_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `insights_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`conditions_json` text NOT NULL,
	`match` text DEFAULT 'all' NOT NULL,
	`actions_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`requests_used` integer DEFAULT 0 NOT NULL,
	`accounts_updated` integer DEFAULT 0 NOT NULL,
	`txns_added` integer DEFAULT 0 NOT NULL,
	`txns_updated` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`transaction_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`sf_txn_id` text NOT NULL,
	`posted` integer NOT NULL,
	`transacted_at` integer,
	`pending` integer DEFAULT false NOT NULL,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`payee` text,
	`memo` text,
	`raw_json` text NOT NULL,
	`category_id` integer,
	`notes` text,
	`payee_override` text,
	`is_transfer` integer DEFAULT false NOT NULL,
	`transfer_pair_id` integer,
	`is_excluded` integer DEFAULT false NOT NULL,
	`is_reviewed` integer DEFAULT false NOT NULL,
	`imported_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_account_sf_unique` ON `transactions` (`account_id`,`sf_txn_id`);--> statement-breakpoint
CREATE INDEX `transactions_posted_idx` ON `transactions` (`posted`);--> statement-breakpoint
CREATE INDEX `transactions_account_posted_idx` ON `transactions` (`account_id`,`posted`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);
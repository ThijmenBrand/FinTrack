CREATE TABLE `split_rule_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`category_id` text NOT NULL,
	`percentage` real,
	`amount` real,
	`is_remainder` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `split_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_split_rule_lines_rule` ON `split_rule_lines` (`rule_id`);--> statement-breakpoint
CREATE TABLE `split_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pattern` text NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`match_field` text DEFAULT 'both' NOT NULL,
	`mode` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `parent_transaction_id` text REFERENCES transactions(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `transactions` ADD `is_split_parent` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_transactions_parent` ON `transactions` (`parent_transaction_id`);
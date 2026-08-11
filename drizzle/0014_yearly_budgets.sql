CREATE TABLE `budget_month_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`budget_id` text NOT NULL,
	`category_id` text NOT NULL,
	`year` integer NOT NULL,
	`month_index` integer NOT NULL,
	`target` real NOT NULL,
	`frozen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_id`) REFERENCES `budget_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_budget_month_targets_slot` ON `budget_month_targets` (`budget_id`,`category_id`,`year`,`month_index`);--> statement-breakpoint
CREATE INDEX `idx_budget_month_targets_lookup` ON `budget_month_targets` (`user_id`,`budget_id`,`year`);--> statement-breakpoint
ALTER TABLE `budget_plans` ADD `period` text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE `budget_plans` ADD `period_started_at` text;
ALTER TABLE `budget_plans` ADD `split_mode` text DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE `budget_plans` ADD `owner_share_amount` real;--> statement-breakpoint
ALTER TABLE `budget_plans` ADD `share_amounts` text;
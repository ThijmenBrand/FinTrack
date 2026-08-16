CREATE TABLE `account_members` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text,
	`expires_at` text,
	`accepted_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_members_token_hash_unique` ON `account_members` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_account_members_user` ON `account_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_account_members_account` ON `account_members` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_account_members_account_email` ON `account_members` (`account_id`,`email`) WHERE revoked_at IS NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `created_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `modified_by` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `main_budget_plan_id` text REFERENCES budget_plans(id);
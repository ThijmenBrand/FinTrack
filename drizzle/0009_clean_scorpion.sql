CREATE TABLE `budget_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`is_main` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_budget_plans_user` ON `budget_plans` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_budget_plans_user_main` ON `budget_plans` (`user_id`) WHERE is_main = 1;--> statement-breakpoint
ALTER TABLE `accounts` ADD `budget_id` text REFERENCES budget_plans(id);--> statement-breakpoint
ALTER TABLE `budgets` ADD `budget_id` text REFERENCES budget_plans(id);--> statement-breakpoint
CREATE INDEX `idx_budgets_plan` ON `budgets` (`budget_id`);--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `count_cross_budget_transfers` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO `budget_plans` (`id`, `user_id`, `name`, `is_main`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), ids.user_id, 'Main', 1,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM (SELECT DISTINCT `user_id` FROM `accounts` UNION SELECT DISTINCT `user_id` FROM `budgets`) AS ids;--> statement-breakpoint
UPDATE `accounts` SET `budget_id` = (SELECT `id` FROM `budget_plans` WHERE `budget_plans`.`user_id` = `accounts`.`user_id` AND `is_main` = 1) WHERE `type` = 'checking';--> statement-breakpoint
UPDATE `budgets` SET `budget_id` = (SELECT `id` FROM `budget_plans` WHERE `budget_plans`.`user_id` = `budgets`.`user_id` AND `is_main` = 1);

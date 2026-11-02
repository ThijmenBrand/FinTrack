CREATE TABLE `pot_budget_line_pot_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`line_id` text NOT NULL,
	`pot_category_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `transaction_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `pot_budget_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_category_id`) REFERENCES `pot_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pot_budget_line_pot_categories_category` ON `pot_budget_line_pot_categories` (`pot_category_id`);--> statement-breakpoint
CREATE INDEX `idx_pot_budget_line_pot_categories_pot` ON `pot_budget_line_pot_categories` (`user_id`,`pot_id`);--> statement-breakpoint
CREATE TABLE `pot_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`parent_category_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `transaction_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pot_categories_pot_parent_name` ON `pot_categories` (`pot_id`,`parent_category_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_pot_categories_user_pot` ON `pot_categories` (`user_id`,`pot_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `pot_category_id` text REFERENCES pot_categories(id);
CREATE TABLE `pot_budget_line_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`line_id` text NOT NULL,
	`category_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `transaction_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `pot_budget_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pot_budget_line_categories_pot_category` ON `pot_budget_line_categories` (`pot_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `idx_pot_budget_line_categories_line` ON `pot_budget_line_categories` (`line_id`);--> statement-breakpoint
CREATE INDEX `idx_pot_budget_line_categories_category` ON `pot_budget_line_categories` (`user_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `pot_budget_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `transaction_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `pot_budget_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pot_budget_lines_pot` ON `pot_budget_lines` (`user_id`,`pot_id`);
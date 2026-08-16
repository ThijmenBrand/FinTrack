CREATE TABLE `budget_sub_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`allocation_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`allocation_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `budget_sub_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_budget_sub_lines_allocation` ON `budget_sub_lines` (`allocation_id`);
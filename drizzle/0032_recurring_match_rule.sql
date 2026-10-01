ALTER TABLE `recurring_transactions` ADD `match_pattern` text;--> statement-breakpoint
ALTER TABLE `recurring_transactions` ADD `match_field` text DEFAULT 'name' NOT NULL;
CREATE TABLE `asset_valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_asset_valuations_account_date` ON `asset_valuations` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_asset_valuations_user_date` ON `asset_valuations` (`user_id`,`date`);--> statement-breakpoint
-- Backfill: every valuation phase one stored directly on the account becomes
-- the first row of its history, so the series starts where the user's own
-- figure did rather than at the next time they open the dialog. The id is
-- derived from the account id so a replayed migration cannot double-insert.
INSERT OR IGNORE INTO `asset_valuations` (`id`, `user_id`, `account_id`, `date`, `value`, `source`, `created_at`)
SELECT 'valbf-' || `id`, `user_id`, `id`, `valued_at`, `current_value`, 'manual', `updated_at`
FROM `accounts`
WHERE `type` = 'investment' AND `current_value` IS NOT NULL AND `valued_at` IS NOT NULL;

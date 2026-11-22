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
CREATE TABLE `instrument_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`date` text NOT NULL,
	`price` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_instrument_prices_instrument_date` ON `instrument_prices` (`instrument_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_instrument_prices_user` ON `instrument_prices` (`user_id`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`isin` text,
	`symbol` text,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`asset_class` text DEFAULT 'equity' NOT NULL,
	`data_source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_instruments_user` ON `instruments` (`user_id`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_trades_account_date` ON `trades` (`account_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_trades_instrument_date` ON `trades` (`instrument_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_trades_user_date` ON `trades` (`user_id`,`date`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `current_value` real;--> statement-breakpoint
ALTER TABLE `accounts` ADD `valued_at` text;--> statement-breakpoint
-- Backfill: a valuation stored directly on the account becomes the first row
-- of its history, so the series starts where the user's own figure did rather
-- than at the next time they open the dialog. A no-op on a database that
-- never ran the earlier split migrations, which is every database but the
-- author's: the columns are created empty just above. The id is derived from
-- the account id so a replayed migration cannot double-insert.
INSERT OR IGNORE INTO `asset_valuations` (`id`, `user_id`, `account_id`, `date`, `value`, `source`, `created_at`)
SELECT 'valbf-' || `id`, `user_id`, `id`, `valued_at`, `current_value`, 'manual', `updated_at`
FROM `accounts`
WHERE `type` = 'investment' AND `current_value` IS NOT NULL AND `valued_at` IS NOT NULL;

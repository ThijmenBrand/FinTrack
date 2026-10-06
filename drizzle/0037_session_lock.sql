CREATE TABLE `session_activity` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`last_active_at` integer NOT NULL,
	`unlock_failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Sessions that predate the lock: under the old 1h sliding expiry, updated_at
-- was the last request. OR IGNORE so a replayed migration stays harmless.
INSERT OR IGNORE INTO `session_activity` (`session_id`, `user_id`, `last_active_at`)
SELECT `id`, `user_id`, CAST(`updated_at` AS INTEGER) FROM `session`;

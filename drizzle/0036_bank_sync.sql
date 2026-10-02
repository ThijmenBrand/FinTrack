CREATE TABLE `bank_account_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`external_uid` text NOT NULL,
	`iban` text,
	`sync_from` text NOT NULL,
	`last_booked_date` text,
	`last_synced_at` text,
	`bank_balance` real,
	`bank_balance_at` text,
	`last_error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `bank_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_account_links_account_id_unique` ON `bank_account_links` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_bank_account_links_user` ON `bank_account_links` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_bank_account_links_connection` ON `bank_account_links` (`connection_id`);--> statement-breakpoint
CREATE TABLE `bank_aspsp_cache` (
	`country` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bank_auth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`state_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`aspsp_name` text NOT NULL,
	`aspsp_country` text NOT NULL,
	`connection_id` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_auth_states_state_hash_unique` ON `bank_auth_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `idx_bank_auth_states_user` ON `bank_auth_states` (`user_id`);--> statement-breakpoint
CREATE TABLE `bank_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`aspsp_name` text NOT NULL,
	`aspsp_country` text NOT NULL,
	`session_id_enc` text,
	`valid_until` text,
	`status` text DEFAULT 'active' NOT NULL,
	`available_accounts` text DEFAULT '[]' NOT NULL,
	`last_error_code` text,
	`expiry_notified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `bank_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_bank_connections_user` ON `bank_connections` (`user_id`);--> statement-breakpoint
CREATE TABLE `bank_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`app_id` text,
	`certificate_pem` text NOT NULL,
	`certificate_fingerprint` text NOT NULL,
	`certificate_not_after` text NOT NULL,
	`private_key_enc` text NOT NULL,
	`status` text DEFAULT 'pending_app_id' NOT NULL,
	`last_error_code` text,
	`verified_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_credentials_user_id_unique` ON `bank_credentials` (`user_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`priority` integer DEFAULT 10 NOT NULL,
	`dedupe_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`run_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`locked_by` text,
	`locked_until` text,
	`last_error_code` text,
	`last_error` text,
	`result` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_claim` ON `jobs` (`status`,`priority`,`run_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_user` ON `jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_jobs_dedupe_active` ON `jobs` (`dedupe_key`) WHERE status IN ('queued', 'running') AND dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE TABLE `step_up_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_step_up_challenges_session` ON `step_up_challenges` (`user_id`,`session_id`);--> statement-breakpoint
CREATE TABLE `step_up_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`method` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_step_up_grants_session` ON `step_up_grants` (`user_id`,`session_id`);--> statement-breakpoint
CREATE TABLE `worker_heartbeat` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `import_batches` ADD `source` text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transactions_account_external` ON `transactions` (`account_id`,`external_id`) WHERE external_id IS NOT NULL;
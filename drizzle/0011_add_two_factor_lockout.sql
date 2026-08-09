ALTER TABLE `twoFactor` ADD `failed_verification_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `twoFactor` ADD `locked_until` integer;
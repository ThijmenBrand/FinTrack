-- Reads were `display_username || name`, so display_username wins where set.
UPDATE `user` SET `name` = `display_username` WHERE `display_username` IS NOT NULL AND `display_username` <> '';--> statement-breakpoint
DROP INDEX IF EXISTS `user_username_unique`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `username`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `display_username`;

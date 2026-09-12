ALTER TABLE `accounts` ADD `internal_transfers` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `counterparty_iban` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `is_mirror` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill the mirrors already in the table. Deliberately tighter than the
-- shape the code used to infer them from (manual + no import batch + linked):
-- a hand-entered row that detectTransfers later paired wears that same shape,
-- and marking one as a mirror would hand it to the delete path. A real mirror
-- is a verbatim copy of its counterpart written in the same breath, so it must
-- also agree on date, description, name and the exact negated amount, and its
-- counterpart must be a row some import actually wrote.
UPDATE `transactions` SET `is_mirror` = 1
WHERE `type` = 'internal_transfer'
  AND `is_manual` = 1
  AND `import_batch_id` IS NULL
  AND `balance` IS NULL
  AND `linked_transaction_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `transactions` AS `src`
    WHERE `src`.`id` = `transactions`.`linked_transaction_id`
      AND `src`.`import_batch_id` IS NOT NULL
      AND `src`.`date` = `transactions`.`date`
      AND `src`.`description` = `transactions`.`description`
      AND `src`.`name` IS `transactions`.`name`
      AND `src`.`amount` = -`transactions`.`amount`
  );

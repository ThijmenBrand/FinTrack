ALTER TABLE `accounts` ADD `bank` text;
--> statement-breakpoint
-- Backfill the slug from the old free-text bank_name so existing accounts keep
-- their bank (and Revolut fee handling turns on) without manual re-selection.
-- Anything unrecognised but non-empty becomes 'other', which keeps showing the
-- original bank_name in the UI rather than losing it.
UPDATE `accounts` SET `bank` = CASE UPPER(TRIM(`bank_name`))
  WHEN 'ABN AMRO' THEN 'abnamro'
  WHEN 'ABNAMRO' THEN 'abnamro'
  WHEN 'ASN BANK' THEN 'asn'
  WHEN 'ASN' THEN 'asn'
  WHEN 'BUNQ' THEN 'bunq'
  WHEN 'ERSTE BANK' THEN 'erste'
  WHEN 'ERSTE' THEN 'erste'
  WHEN 'ING' THEN 'ing'
  WHEN 'KNAB' THEN 'knab'
  WHEN 'N26' THEN 'n26'
  WHEN 'RABOBANK' THEN 'rabobank'
  WHEN 'REVOLUT' THEN 'revolut'
  WHEN 'SNS BANK' THEN 'sns'
  WHEN 'SNS' THEN 'sns'
  WHEN 'TRIODOS BANK' THEN 'triodos'
  WHEN 'TRIODOS' THEN 'triodos'
  WHEN 'WISE' THEN 'wise'
  ELSE 'other'
END
WHERE `bank_name` IS NOT NULL AND TRIM(`bank_name`) <> '';

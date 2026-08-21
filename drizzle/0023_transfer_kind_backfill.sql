-- Widens 0021's transfer backfill, which matched only the two seeded spellings
-- ('Internal Transfer', 'Interne overboeking'). Anyone who had RENAMED their
-- internal-transfer bucket kept kind = 'expense', and since findTransferCategory
-- now looks the bucket up by kind rather than by name, transfer detection would
-- silently stop finding one — and the bucket would start showing up in "top
-- spending categories".
--
-- The reliable signal is use, not spelling: a category that internal_transfer
-- rows point at IS the transfer bucket. Guarded by the NOT EXISTS so a category
-- that merely got one transfer row by accident (and is otherwise a real spending
-- category) is left alone — only categories used exclusively by transfers are
-- promoted.
--
-- Data-only; the schema is unchanged since 0022.
UPDATE `categories` SET `kind` = 'transfer'
WHERE `kind` = 'expense'
  AND EXISTS (
    SELECT 1 FROM `transactions` t
    WHERE t.`category_id` = `categories`.`id`
      AND t.`user_id` = `categories`.`user_id`
      AND t.`type` = 'internal_transfer'
  )
  AND NOT EXISTS (
    SELECT 1 FROM `transactions` t
    WHERE t.`category_id` = `categories`.`id`
      AND t.`user_id` = `categories`.`user_id`
      AND t.`type` != 'internal_transfer'
  );

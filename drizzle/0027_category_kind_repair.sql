-- Repair for categories whose `kind` fell outside the enum (NULL or anything
-- else, e.g. a DB where 0021's ALTER was skipped as already-applied while its
-- backfill still ran). The settings list groups strictly by kind, so such a row
-- is filtered out of every group and disappears while the heading still counts
-- it — and budgets, insights and transfer detection, which all ask by kind,
-- can't see it either. Restore the column default; a row that was really
-- income or transfer is one dropdown away in settings.
--
-- Data-only; the schema is unchanged since 0026. No-op on a healthy DB.
UPDATE `categories` SET `kind` = 'expense'
WHERE `kind` IS NULL OR `kind` NOT IN ('income', 'expense', 'transfer');

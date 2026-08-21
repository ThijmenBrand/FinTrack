ALTER TABLE `categories` ADD `kind` text DEFAULT 'expense' NOT NULL;
--> statement-breakpoint
-- Backfill: every existing category is an expense (the column default) except
-- the two seeded buckets that never were. Names are stored rows seeded per
-- locale, so each locale's spelling has to be matched — see
-- NON_BUDGETABLE_CATEGORY_NAMES, which this replaces. Renamed categories keep
-- the default and the user re-labels them in settings.
UPDATE `categories` SET `kind` = 'income'
  WHERE `name` IN ('Salary', 'Salaris', 'Income - Other');
--> statement-breakpoint
UPDATE `categories` SET `kind` = 'transfer'
  WHERE `name` IN ('Internal Transfer', 'Interne overboeking');

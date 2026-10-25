-- Custom SQL migration file, put your code below! ---- A spending target is for exactly one category or one tag, and there is at most one target per subject per scope
-- (one recurring target, plus at most one override for each specific month).
CREATE UNIQUE INDEX `budgets_category_scope_unique` ON `budgets` (`category_id`, coalesce(`month`, '')) WHERE `category_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_tag_scope_unique` ON `budgets` (`tag_id`, coalesce(`month`, '')) WHERE `tag_id` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `budgets_one_subject_insert` BEFORE INSERT ON `budgets`
WHEN (NEW.`category_id` IS NULL) = (NEW.`tag_id` IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a target needs exactly one category or tag');
END;
--> statement-breakpoint
CREATE TRIGGER `budgets_one_subject_update` BEFORE UPDATE OF `category_id`, `tag_id` ON `budgets`
WHEN (NEW.`category_id` IS NULL) = (NEW.`tag_id` IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a target needs exactly one category or tag');
END;

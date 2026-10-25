ALTER TABLE `transactions` ADD `merchant_key` text;--> statement-breakpoint
CREATE INDEX `transactions_merchant_idx` ON `transactions` (`merchant_key`);--> statement-breakpoint
-- merchant_key is derived data. It's maintained by triggers calling the payee_key() SQL function, which the
-- application registers on every connection (see src/db/open.ts), so every writer is covered automatically.
CREATE TRIGGER `transactions_merchant_key_insert` AFTER INSERT ON `transactions`
BEGIN
  UPDATE `transactions` SET `merchant_key` = payee_key(coalesce(nullif(trim(`payee_override`), ''), nullif(trim(`payee`), ''), `description`)) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `transactions_merchant_key_update` AFTER UPDATE OF `payee`, `payee_override`, `description` ON `transactions`
BEGIN
  UPDATE `transactions` SET `merchant_key` = payee_key(coalesce(nullif(trim(`payee_override`), ''), nullif(trim(`payee`), ''), `description`)) WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
UPDATE `transactions` SET `merchant_key` = payee_key(coalesce(nullif(trim(`payee_override`), ''), nullif(trim(`payee`), ''), `description`)) WHERE `merchant_key` IS NULL;

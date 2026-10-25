-- Splits must always add up to the parent. If a transaction's amount changes (the bank revised a pending charge, or
-- the user edited a manual one), the old split no longer fits, so it is dropped and the user can split it again.
CREATE TRIGGER `transactions_amount_clears_splits` AFTER UPDATE OF `amount_cents` ON `transactions`
WHEN OLD.`amount_cents` <> NEW.`amount_cents`
BEGIN
  DELETE FROM `transaction_splits` WHERE `transaction_id` = NEW.`id`;
END;

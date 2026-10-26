# Migrating from Actual Budget

SimpleBudget can take over your transaction history from Actual Budget. It is **history and categories**, not a full clone: Actual's
envelope budgets, category groups, schedules and payee rules are not carried over (they are not in its transaction export), and SimpleBudget's
own "targets" and rules are separate features you set up afresh.

## What moves, and what doesn't
| From Actual | In SimpleBudget |
| --- | --- |
| Transactions (date, payee, notes, category, amount) | imported; matched against what SimpleFIN already gave you, the rest added as `source = import` |
| Categories | created if they don't exist yet (a category that only ever receives money becomes an *income* category) |
| Accounts | each account name in the file is mapped to an existing account, a new manual account, or skipped |
| Notes | copied onto matched transactions when they have no notes yet |
| Cleared/reconciled flags | ignored (imported rows are marked *reviewed* because you already reviewed them) |
| Budget amounts, category groups, rules, schedules, tags | **not imported** (recreate rules under *Rules*, limits under *Targets*) |

## Before you start
1. Run SimpleBudget and finish the setup wizard (see the main README). **Connect SimpleFIN and import as much history as you can first** (the wizard offers up to 365 days).
   Doing this first matters: the importer matches Actual's rows against the bank transactions SimpleFIN delivered, so overlapping history is not duplicated.
2. Want more than a year of SimpleFIN history? Run a longer backfill while signed in: `POST /api/sync` with `{"mode":"backfill","days":365}` (it uses about 7 of your 20 daily SimpleFIN requests; the bank decides how far back it really goes).
3. Make sure the accounts exist: your SimpleFIN accounts appear automatically; for cash or accounts SimpleFIN can't see, you can let the importer create *manual* accounts (step 4) or create them first under **Accounts → Add manual account**.

## Step by step
### 1. Export from Actual
In Actual, open an account and use the **⋯ menu → Export** (CSV). Do this for each account you want (some versions also offer the same on the *All accounts* view).
Each file looks like:
```
Account,Date,Payee,Notes,Category,Amount,Cleared
Checking,2025-03-01,Landlord,March rent,Rent/Mortgage,-1800.00,true
```
(Actual's full-budget export, Settings → Export data, is a SQLite/zip archive; SimpleBudget doesn't read that. Use the CSVs.)

### 2. Open the importer
**Settings → Import** → choose a CSV. Actual's layout is recognized automatically (Account, Date, Payee, Notes, Category, Amount). The page shows how many rows were found and how many can't be read.
Check the mapping boxes; if your file has no `Account` column (single-account export), the whole file goes to one destination you pick in step 3.
Date format defaults to year-month-day, which is what Actual writes.

### 3. Match accounts
Every distinct account name in the file gets a destination:
- an **existing account** (names that match yours exactly are pre-selected),
- **Create a new manual account** (for history you want to keep that has no SimpleFIN counterpart, e.g. a closed account),
- or **Skip these rows**.

### 4. Preview, then import
**Preview** shows, without saving anything:
- **New**: rows added as imported transactions (only when they are *older than that account's synced history*),
- **Matched**: rows that correspond to a transaction you already have (same amount, date within ±2 days, one-to-one). Only *empty* fields are filled (category, notes); nothing you or a rule already set is overwritten, and a split transaction keeps its split,
- **Skipped**: rows inside your synced history with no matching transaction (assumed to be duplicates or bank differences; the reason is listed), accounts you chose to skip, and unreadable lines (with their line numbers),
- the categories and accounts that will be created.
When it looks right, press **Import**. Rules and transfer detection then run on the new rows.

Re-running the same file is safe: everything is found again as "already here" and nothing is duplicated.

### 5. Verify
- **Accounts → an account → Reconcile**: enter a statement date and the balance Actual (or your bank) shows for it. The app computes what its transactions imply at the end of that day and tells you if they differ. If they match, offer to mark everything up to that day as reviewed.
  Imported history does **not** change account balances (the balance is the bank's; history only adds rows), so for a manual account use *Set balance* to match reality.
- **Spending** for a past month should be close to what Actual reported. Differences usually come from transfers (Actual shows them as "Transfer: Account" payees; SimpleBudget pairs opposite-sign rows across accounts automatically) and from split transactions.
- **Settings → Categories**: merge duplicates created by slightly different names (the merge moves transactions, splits, targets and rules).

### 6. Recreate what isn't imported
- **Rules** (Actual "payee rules"): *Rules → New rule*; use *Preview* to see what it would touch, then *Apply to history*.
- **Budgets**: SimpleBudget has optional **targets** per category or tag (Settings → Categories → "Set monthly target…").
- **Recurring bills/schedules**: detected automatically from history (Spending page, dashboard "Upcoming", Forecast).

## Troubleshooting
| Symptom | Likely cause / fix |
| --- | --- |
| "Couldn't read the date …" for every row | wrong date format selected; pick the one the file uses (Actual: year-month-day) |
| Everything is skipped "inside your synced history" | the account has SimpleFIN history covering those dates but amounts/dates differ; check amount sign (negative = money out) and that you chose the right destination account |
| Rows land in a new account instead of mine | the account name differs (e.g. "Checking" vs "Total Checking"); choose the destination manually in step 3 |
| Counts differ from Actual by a few rows | Actual lists split children as separate rows; check the preview's sample and reconcile |
| Credit card shows opposite signs | turn on **Charges are positive numbers** (only for non-Actual CSVs that list purchases as positives) |
| File too large | the limit is 10 MB / 50,000 rows per file; export per account or split the file |

## For developers
Code: `src/lib/import/parse.ts` (columns, money, dates), `src/lib/import/plan.ts` (matching + commit), UI `src/components/import/import-wizard.tsx`,
API `POST /api/import/preview` and `/api/import/commit`, tests `tests/unit/import-*.test.ts`, `tests/e2e/import.spec.ts`. Design notes: `DECISIONS.md` → *Phase 10*.

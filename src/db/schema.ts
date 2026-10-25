import { sql } from "drizzle-orm";
import { ACCOUNT_TYPES } from "../lib/finance/account-types";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const nowSeconds = sql`(unixepoch())`;

export { ACCOUNT_TYPES, type AccountType } from "../lib/finance/account-types";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgName: text("org_name").notNull(),
  orgDomain: text("org_domain"),
  sfinUrl: text("sfin_url"),
  createdAt: integer("created_at").notNull().default(nowSeconds),
  lastError: text("last_error"),
});

export const accounts = sqliteTable("accounts", {
  /** The SimpleFIN account id. */
  id: text("id").primaryKey(),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "cascade" }),
  orgName: text("org_name").notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  balanceCents: integer("balance_cents").notNull().default(0),
  availableCents: integer("available_cents"),
  balanceDate: integer("balance_date"),
  // user overlay
  displayName: text("display_name"),
  type: text("type", { enum: ACCOUNT_TYPES }).notNull().default("other"),
  isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
  isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
  excludeFromNetWorth: integer("exclude_from_net_worth", { mode: "boolean" }).notNull().default(false),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull().default(nowSeconds),
  updatedAt: integer("updated_at").notNull().default(nowSeconds),
});

export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    balanceCents: integer("balance_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.date] })],
);

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  groupName: text("group_name"),
  color: text("color").notNull(),
  icon: text("icon"),
  isIncome: integer("is_income", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
});

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    color: text("color").notNull(),
  },
  (t) => [uniqueIndex("tags_name_unique").on(t.name)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    sfTxnId: text("sf_txn_id").notNull(),
    posted: integer("posted").notNull(),
    transactedAt: integer("transacted_at"),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    payee: text("payee"),
    memo: text("memo"),
    rawJson: text("raw_json").notNull(),
    // user overlay
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    notes: text("notes"),
    payeeOverride: text("payee_override"),
    /**
     * Normalized merchant ("traderjoes") derived from payee override / payee / description by SQLite triggers
     * (see the merchant_key migration), so merchants can be grouped and filtered in SQL. Never written directly.
     */
    merchantKey: text("merchant_key"),
    isTransfer: integer("is_transfer", { mode: "boolean" }).notNull().default(false),
    transferPairId: integer("transfer_pair_id"),
    isExcluded: integer("is_excluded", { mode: "boolean" }).notNull().default(false),
    isReviewed: integer("is_reviewed", { mode: "boolean" }).notNull().default(false),
    importedAt: integer("imported_at").notNull().default(nowSeconds),
    updatedAt: integer("updated_at").notNull().default(nowSeconds),
  },
  (t) => [
    uniqueIndex("transactions_account_sf_unique").on(t.accountId, t.sfTxnId),
    index("transactions_posted_idx").on(t.posted),
    index("transactions_account_posted_idx").on(t.accountId, t.posted),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_merchant_idx").on(t.merchantKey),
  ],
);

export const transactionTags = sqliteTable(
  "transaction_tags",
  {
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] })],
);

export const rules = sqliteTable("rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  priority: integer("priority").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  conditionsJson: text("conditions_json").notNull(),
  match: text("match", { enum: ["all", "any"] })
    .notNull()
    .default("all"),
  actionsJson: text("actions_json").notNull(),
  createdAt: integer("created_at").notNull().default(nowSeconds),
});

export const budgets = sqliteTable("budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").references(() => tags.id, { onDelete: "cascade" }),
  /** YYYY-MM, or NULL for recurring every month. */
  month: text("month"),
  amountCents: integer("amount_cents").notNull(),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  status: text("status", { enum: ["ok", "partial", "error"] }).notNull(),
  requestsUsed: integer("requests_used").notNull().default(0),
  accountsUpdated: integer("accounts_updated").notNull().default(0),
  txnsAdded: integer("txns_added").notNull().default(0),
  txnsUpdated: integer("txns_updated").notNull().default(0),
  errorsJson: text("errors_json").notNull().default("[]"),
});

export const insightsCache = sqliteTable("insights_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  month: text("month").notNull(),
  kind: text("kind").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: integer("created_at").notNull().default(nowSeconds),
});

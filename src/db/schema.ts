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
  /** Credit limit (cents), for utilization insights. Optional; only meaningful for credit accounts. */
  creditLimitCents: integer("credit_limit_cents"),
  /** Alert when this account's balance falls below this many cents. Optional. */
  lowBalanceCents: integer("low_balance_cents"),
  /** Offline account (e.g. cash) the user maintains by hand. Sync never touches it. */
  isManual: integer("is_manual", { mode: "boolean" }).notNull().default(false),
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

export const TRANSACTION_SOURCES = ["simplefin", "import", "manual"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

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
    /** Where the row came from: the bank sync, an import file, or typed in by hand. */
    source: text("source", { enum: TRANSACTION_SOURCES }).notNull().default("simplefin"),
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

/** One part of a split transaction. A transaction's splits always add up to its amount. */
export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    /** Same sign as the parent transaction. */
    amountCents: integer("amount_cents").notNull(),
    notes: text("notes"),
  },
  (t) => [
    index("transaction_splits_txn_idx").on(t.transactionId),
    index("transaction_splits_category_idx").on(t.categoryId),
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

/** Positions inside an investment account, as reported by SimpleFIN when the institution provides them. */
export const holdings = sqliteTable(
  "holdings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** SimpleFIN's id for the holding. */
    sfId: text("sf_id").notNull(),
    symbol: text("symbol").notNull().default(""),
    description: text("description").notNull().default(""),
    /** Decimal string; fractional shares are common. */
    shares: text("shares").notNull().default("0"),
    marketValueCents: integer("market_value_cents").notNull(),
    costBasisCents: integer("cost_basis_cents"),
    currency: text("currency").notNull().default("USD"),
    updatedAt: integer("updated_at").notNull().default(nowSeconds),
  },
  (t) => [uniqueIndex("holdings_account_sf_unique").on(t.accountId, t.sfId)],
);

/** A savings goal, tracked against the balance of one account. */
export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  targetCents: integer("target_cents").notNull(),
  /** What in the account was already set aside before the goal began (progress counts balance above this). */
  startCents: integer("start_cents").notNull().default(0),
  /** `YYYY-MM-DD`, optional. */
  targetDate: text("target_date"),
  color: text("color"),
  createdAt: integer("created_at").notNull().default(nowSeconds),
});

export const AI_TRIGGERS = ["manual", "after_sync", "interval", "automation"] as const;
export type AiTrigger = (typeof AI_TRIGGERS)[number];

/** One row per model request, for the usage report and the monthly budget. Never holds prompt text. */
export const aiRuns = sqliteTable(
  "ai_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** An `AiFeature`. */
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    trigger: text("trigger", { enum: AI_TRIGGERS }).notNull(),
    status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
    /** Short, non-sensitive description of what the run was for, e.g. "12 merchants" or "thread 4". */
    subject: text("subject"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    /** Reported or estimated cost in micro-USD; null when neither is known. */
    costMicros: integer("cost_micros"),
    costEstimated: integer("cost_estimated", { mode: "boolean" }).notNull().default(false),
    /** LlmError kind on failure. Never the provider's raw error text. */
    errorKind: text("error_kind"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("ai_runs_started_idx").on(t.startedAt)],
);

export const PROPOSAL_KINDS = ["rule", "memory", "target"] as const;
export const PROPOSAL_STATUSES = ["pending", "accepted", "dismissed", "no_match", "stale"] as const;
export const PROPOSAL_SOURCES = ["rules_job", "assistant"] as const;

/** Things the AI wants to change, waiting for the owner to apply or dismiss them. */
export const aiProposals = sqliteTable(
  "ai_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: PROPOSAL_KINDS }).notNull(),
    status: text("status", { enum: PROPOSAL_STATUSES }).notNull().default("pending"),
    source: text("source", { enum: PROPOSAL_SOURCES }).notNull(),
    /** Dedupe key: "category:<direction>:<payeeKey>" or "tag:<merchantKey>:<tagId>" for rules. */
    subjectKey: text("subject_key"),
    payloadJson: text("payload_json").notNull(),
    /** Dry-run counts at creation time (recomputed when listed). */
    previewJson: text("preview_json"),
    confidence: text("confidence", { enum: ["low", "medium", "high"] }),
    model: text("model"),
    aiRunId: integer("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    /** The conversation that produced it (a plain integer; the threads table arrives with the assistant). */
    threadId: integer("thread_id"),
    /** The rule created or extended on accept. */
    ruleId: integer("rule_id").references(() => rules.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("ai_proposals_status_idx").on(t.kind, t.status), index("ai_proposals_subject_idx").on(t.subjectKey)],
);

export const aiThreads = sqliteTable("ai_threads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  lens: text("lens").notNull().default("general"),
  /** Rolling summary of the messages up to `summaryUpTo` (a message id). */
  summary: text("summary"),
  summaryUpTo: integer("summary_up_to"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: integer("thread_id")
      .notNull()
      .references(() => aiThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    model: text("model"),
    aiRunId: integer("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    /** Names of tools the model called while writing this message, JSON array. */
    toolsJson: text("tools_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ai_messages_thread_idx").on(t.threadId, t.id)],
);

/** Facts about the owner that the owner wrote or approved; sent with every AI request. */
export const aiMemories = sqliteTable("ai_memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  source: text("source", { enum: ["user", "assistant"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const aiInsights = sqliteTable(
  "ai_insights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Cards generated together share a batch id. */
    batch: integer("batch").notNull(),
    lens: text("lens").notNull(),
    model: text("model"),
    aiRunId: integer("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    severity: text("severity", { enum: ["info", "good", "warn"] }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    factIdsJson: text("fact_ids_json").notNull(),
    link: text("link"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    dismissedAt: integer("dismissed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ai_insights_batch_idx").on(t.batch)],
);

export const NOTIFY_DESTINATION_KINDS = ["ntfy", "webhook", "discord"] as const;

/** Places automations can send to. Addresses are encrypted and write-only, like the alert target. */
export const notifyDestinations = sqliteTable("notify_destinations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: NOTIFY_DESTINATION_KINDS }).notNull(),
  urlEnc: text("url_enc").notNull(),
  tokenEnc: text("token_enc"),
  createdAt: integer("created_at").notNull(),
});

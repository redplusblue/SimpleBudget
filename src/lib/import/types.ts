import { z } from "zod";

// Client-safe: shared by the import page, the preview/commit API and the importer.

export const DATE_FORMATS = ["iso", "mdy", "dmy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  iso: "Year-month-day (2026-10-24)",
  mdy: "Month/day/year (10/24/2026)",
  dmy: "Day/month/year (24/10/2026)",
};

const column = z.number().int().min(0).max(200).nullable();

export const columnMappingSchema = z.object({
  date: z.number().int().min(0).max(200),
  /** One signed amount column (negative = money out)... */
  amount: column,
  /** ...or separate money-out / money-in columns. Exactly one style must be set. */
  debit: column,
  credit: column,
  /** Statements from credit cards often list charges as positive numbers. */
  invertSigns: z.boolean(),
  payee: column,
  notes: column,
  category: column,
  account: column,
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

/** What to do with the rows of one account name found in the file. */
export const accountTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("existing"), accountId: z.string().min(1).max(200) }),
  z.object({ type: z.literal("new"), name: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal("skip") }),
]);
export type AccountTarget = z.infer<typeof accountTargetSchema>;

export const MAX_IMPORT_CHARS = 10_000_000;
export const MAX_IMPORT_ROWS = 50_000;
/** The label used when the file has no account column. */
export const SINGLE_ACCOUNT_LABEL = "(all rows)";

export const importRequestSchema = z.object({
  csv: z.string().min(1, "The file is empty").max(MAX_IMPORT_CHARS, "That file is too large (10 MB at most)"),
  /** Whether the first row holds column names. */
  hasHeader: z.boolean(),
  dateFormat: z.enum(DATE_FORMATS),
  mapping: columnMappingSchema,
  /** Keyed by the account name as written in the file. */
  accounts: z.record(z.string(), accountTargetSchema),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export type RowAction = "match" | "insert" | "skip";

export interface ImportedRow {
  /** 1-based line number in the file (counting the header), for error messages. */
  line: number;
  accountLabel: string;
  date: string;
  amountCents: number;
  payee: string;
  notes: string;
  category: string;
}

export interface PlannedRow extends ImportedRow {
  action: RowAction;
  /** Why a row is skipped, or what a match means. */
  reason: string | null;
  /** The existing transaction a `match` row was paired with. */
  matchId: number | null;
  /** Resolved destination account id (null for accounts that will be created). */
  accountId: string | null;
  /** What a match would change on the existing transaction. */
  fills: Array<"category" | "notes">;
}

export interface ParseProblem {
  line: number;
  message: string;
}

export interface ImportPreview {
  totalRows: number;
  matches: number;
  inserts: number;
  skipped: number;
  problems: ParseProblem[];
  /** Categories that will be created (they don't exist yet). */
  newCategories: string[];
  /** Accounts that will be created. */
  newAccounts: string[];
  /** A sample of rows per outcome, for the preview table. */
  sample: PlannedRow[];
  skipReasons: Array<{ reason: string; count: number }>;
}

export interface ImportResult extends ImportPreview {
  inserted: number;
  updated: number;
  categoriesCreated: number;
  accountsCreated: number;
}

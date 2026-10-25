import { parseCsv } from "@/lib/export/csv";
import { parseCents } from "@/lib/finance/cents";
import { isDateString } from "@/lib/finance/dates";
import type { ColumnMapping, DateFormat, ImportedRow, ParseProblem } from "./types";
import { MAX_IMPORT_ROWS, SINGLE_ACCOUNT_LABEL } from "./types";

// Pure functions (no database), so the import page can use them in the browser to build the mapping screen.

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const HEADER_GUESSES: Record<keyof Omit<ColumnMapping, "invertSigns">, string[]> = {
  date: ["date", "transaction date", "posted date", "posting date", "post date"],
  amount: ["amount", "transaction amount", "value"],
  debit: ["debit", "withdrawal", "withdrawals", "payment", "outflow", "money out"],
  credit: ["credit", "deposit", "deposits", "inflow", "money in"],
  payee: ["payee", "description", "merchant", "name", "memo", "details"],
  notes: ["notes", "note", "memo"],
  category: ["category"],
  account: ["account", "account name"],
};

export interface MappingGuess {
  mapping: ColumnMapping;
  /** True for Actual Budget's own export (Account, Date, Payee, Notes, Category, Amount). */
  isActual: boolean;
}

/** Guesses which column is which from the header names. The user can change every choice. */
export function guessMapping(headers: string[]): MappingGuess {
  const names = headers.map(norm);
  const find = (key: keyof typeof HEADER_GUESSES, skip: Set<number> = new Set()): number | null => {
    for (const guess of HEADER_GUESSES[key]) {
      const i = names.findIndex((n, idx) => n === guess && !skip.has(idx));
      if (i >= 0) return i;
    }
    return null;
  };
  const used = new Set<number>();
  const take = (key: keyof typeof HEADER_GUESSES) => {
    const i = find(key, used);
    if (i !== null) used.add(i);
    return i;
  };
  const date = take("date");
  const amount = take("amount");
  const debit = amount === null ? take("debit") : null;
  const credit = amount === null ? take("credit") : null;
  const category = take("category");
  const account = take("account");
  // "Notes" and "memo" can both exist; the payee prefers payee/description/merchant, notes prefers notes/note.
  const payee = take("payee");
  const notes = take("notes");
  const isActual = ["account", "date", "payee", "notes", "category", "amount"].every((h) => names.includes(h));
  return {
    isActual,
    mapping: { date: date ?? 0, amount, debit, credit, invertSigns: false, payee, notes, category, account },
  };
}

/** Reads money the way banks write it: $1,234.56, (12.00), 12.00-, -12, "1 234,56" is not supported. */
export function parseMoneyLoose(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/[$£€\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  try {
    const cents = Math.abs(parseCents(s.endsWith(".") ? s.slice(0, -1) : s));
    return negative ? -cents : cents;
  } catch {
    return null;
  }
}

/** Parses a date in the chosen format to `YYYY-MM-DD`, or null if it isn't a real date. */
export function parseDateLoose(raw: string, format: DateFormat): string | null {
  const s = raw.trim().replace(/[T ].*$/, ""); // drop any time of day
  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(s);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (format === "iso") [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if (format === "mdy") [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 100) y += 2000;
  if (y < 1970 || y > 2100) return null;
  const out = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isDateString(out) ? out : null;
}

export interface ParsedFile {
  headers: string[];
  rows: ImportedRow[];
  problems: ParseProblem[];
  /** Number of data rows in the file, including ones that couldn't be read. */
  dataRows: number;
}

const cell = (row: string[], i: number | null) => (i === null ? "" : (row[i] ?? "").trim());

/** Turns CSV text into import rows using the column mapping; unreadable rows become problems, never exceptions. */
export function parseImportFile(
  text: string,
  hasHeader: boolean,
  dateFormat: DateFormat,
  mapping: ColumnMapping,
): ParsedFile {
  const all = parseCsv(text);
  const headers = hasHeader ? (all[0] ?? []) : (all[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const body = hasHeader ? all.slice(1) : all;
  const rows: ImportedRow[] = [];
  const problems: ParseProblem[] = [];
  if (body.length > MAX_IMPORT_ROWS) {
    problems.push({
      line: 0,
      message: `That file has ${body.length.toLocaleString()} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString()}. Split it and import in parts.`,
    });
    return { headers, rows, problems, dataRows: body.length };
  }
  const signed = mapping.amount !== null;
  body.forEach((r, i) => {
    const line = i + 1 + (hasHeader ? 1 : 0);
    const date = parseDateLoose(cell(r, mapping.date), dateFormat);
    if (!date) return void problems.push({ line, message: `Couldn't read the date "${cell(r, mapping.date)}"` });

    let cents: number | null;
    if (signed) {
      cents = parseMoneyLoose(cell(r, mapping.amount));
      if (cents === null)
        return void problems.push({ line, message: `Couldn't read the amount "${cell(r, mapping.amount)}"` });
    } else {
      const out = parseMoneyLoose(cell(r, mapping.debit));
      const inn = parseMoneyLoose(cell(r, mapping.credit));
      if (out === null && inn === null)
        return void problems.push({ line, message: "No amount in the debit or credit column" });
      cents = Math.abs(inn ?? 0) - Math.abs(out ?? 0);
    }
    if (mapping.invertSigns) cents = -cents;
    if (cents === 0) return void problems.push({ line, message: "The amount is zero" });

    rows.push({
      line,
      accountLabel: mapping.account === null ? SINGLE_ACCOUNT_LABEL : cell(r, mapping.account) || "(no account)",
      date,
      amountCents: cents,
      payee: cell(r, mapping.payee),
      notes: cell(r, mapping.notes),
      category: cell(r, mapping.category),
    });
  });
  return { headers, rows, problems, dataRows: body.length };
}

/** The distinct account names in the file, in first-seen order. */
export function accountLabels(rows: ImportedRow[]): string[] {
  return [...new Set(rows.map((r) => r.accountLabel))];
}

/** Checks a mapping makes sense before parsing (one amount style, distinct required columns). */
export function mappingProblem(m: ColumnMapping): string | null {
  const hasSigned = m.amount !== null;
  const hasSplit = m.debit !== null || m.credit !== null;
  if (hasSigned && hasSplit) return "Choose either one amount column or separate debit/credit columns, not both.";
  if (!hasSigned && !hasSplit) return "Choose the amount column (or debit and credit columns).";
  return null;
}

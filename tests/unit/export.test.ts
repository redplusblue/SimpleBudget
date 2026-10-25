import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createBackup } from "@/lib/export/backup";
import { escapeCell, parseCsv, toCsv } from "@/lib/export/csv";
import { EXPORT_HEADER, exportTransactionsCsv } from "@/lib/export/transactions";
import { zonedDayStart } from "@/lib/finance/dates";
import { setSplits } from "@/lib/finance/splits";
import { transactionTags } from "@/db/schema";
import { addAccount, addTag, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;

describe("csv", () => {
  it("quotes cells that need it and doubles quotes", () => {
    expect(escapeCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(escapeCell("line\nbreak")).toBe('"line\nbreak"');
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(0)).toBe("0");
    expect(escapeCell(true)).toBe("true");
  });

  it("defuses spreadsheet formulas in text but leaves plain numbers alone", () => {
    expect(escapeCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(escapeCell("+cmd|' /C calc'!A0")).toContain("'+cmd");
    expect(escapeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCell("-12.50")).toBe("-12.50");
    expect(escapeCell(-1250)).toBe("-1250");
  });

  it("round-trips through parseCsv, including BOM, CRLF and embedded newlines", () => {
    const rows = [
      ["a", 'b "q"', "c,d"],
      ["1", "two\nlines", ""],
      ["", "", "x"],
    ];
    const text = toCsv(["h1", "h2", "h3"], rows);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(parseCsv(`﻿${text}`)).toEqual([["h1", "h2", "h3"], ...rows]);
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\r\n\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]); // blank lines skipped
    expect(parseCsv("")).toEqual([]);
  });
});

describe("exportTransactionsCsv", () => {
  it("writes every transaction, newest first, with categories, splits, tags and flags", () => {
    const db = freshDb();
    addAccount(db, "A", { displayName: "Everyday" });
    const [groceries, shopping] = [categoryId(db, "Groceries"), categoryId(db, "Shopping")];
    const work = addTag(db, "work");
    const old = addTxn(db, "A", {
      posted: at("2026-10-01"),
      amountCents: -1_250,
      description: 'COFFEE, "The Cup"',
      categoryId: groceries,
      notes: "morning",
    });
    const split = addTxn(db, "A", {
      posted: at("2026-10-05"),
      amountCents: -10_000,
      description: "COSTCO",
      payeeOverride: "Costco",
    });
    setSplits(db, split.id, {
      parts: [
        { categoryId: groceries, amountCents: -7_000 },
        { categoryId: shopping, amountCents: -3_000 },
      ],
    });
    db.insert(transactionTags).values({ transactionId: split.id, tagId: work.id }).run();
    addTxn(db, "A", {
      posted: 0,
      pending: true,
      transactedAt: at("2026-10-07"),
      amountCents: 500,
      description: "=EVIL()",
      isTransfer: true,
    });

    const rows = parseCsv(exportTransactionsCsv(db, TZ));
    expect(rows[0]).toEqual(EXPORT_HEADER);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r[0])).toEqual(["Date", "2026-10-07", "2026-10-05", "2026-10-01"]);
    const [, pending, splitRow, oldRow] = rows;
    expect(oldRow).toEqual([
      "2026-10-01",
      "Everyday",
      'COFFEE, "The Cup"',
      'COFFEE, "The Cup"',
      "-12.50",
      "Groceries",
      "",
      "",
      "morning",
      "no",
      "no",
      "no",
      "no",
      "simplefin",
      String(old.id),
    ]);
    expect(splitRow.slice(2, 8)).toEqual([
      "Costco",
      "COSTCO",
      "-100.00",
      "",
      "Groceries: -70.00; Shopping: -30.00",
      "work",
    ]);
    expect(pending.slice(3, 5)).toEqual(["'=EVIL()", "5.00"]);
    expect(pending.slice(9, 11)).toEqual(["yes", "yes"]);
  });

  it("is just the header for an empty database", () => {
    expect(parseCsv(exportTransactionsCsv(freshDb(), TZ))).toEqual([EXPORT_HEADER]);
  });
});

describe("createBackup", () => {
  it("produces a standalone SQLite file with the same data", () => {
    const db = freshDb();
    addAccount(db, "A");
    addTxn(db, "A", { amountCents: -1_234, description: "Backed up" });
    const bytes = createBackup(db);
    expect(bytes.subarray(0, 15).toString()).toBe("SQLite format 3");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-"));
    try {
      const file = path.join(dir, "restored.sqlite");
      fs.writeFileSync(file, bytes);
      const copy = new Database(file, { readonly: true });
      expect(copy.prepare("select description, amount_cents from transactions").all()).toEqual([
        { description: "Backed up", amount_cents: -1_234 },
      ]);
      expect(copy.prepare("select count(*) as n from accounts").get()).toEqual({ n: 1 });
      copy.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

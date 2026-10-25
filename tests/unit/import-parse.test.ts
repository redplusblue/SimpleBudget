import { describe, expect, it } from "vitest";
import {
  guessMapping,
  mappingProblem,
  parseDateLoose,
  parseImportFile,
  parseMoneyLoose,
  accountLabels,
} from "@/lib/import/parse";
import type { ColumnMapping } from "@/lib/import/types";

describe("parseMoneyLoose", () => {
  it.each([
    ["12.50", 1250],
    ["-12.50", -1250],
    ["$1,234.56", 123456],
    ["-$1,234.56", -123456],
    ["(45.00)", -4500],
    ["45.00-", -4500],
    ["+7", 700],
    [" 3 ", 300],
    [".5", 50],
    ["1,234,567.89", 123456789],
    ["12.", 1200],
    ["£9.99", 999],
  ])("%s -> %d", (input, cents) => expect(parseMoneyLoose(input)).toBe(cents));

  it.each(["", "abc", "1.234,56", "12.345", "1.2.3", "--5", "$"])("rejects %j", (input) =>
    expect(parseMoneyLoose(input)).toBeNull(),
  );
});

describe("parseDateLoose", () => {
  it("reads each format and normalizes to YYYY-MM-DD", () => {
    expect(parseDateLoose("2026-10-24", "iso")).toBe("2026-10-24");
    expect(parseDateLoose("2026/1/5", "iso")).toBe("2026-01-05");
    expect(parseDateLoose("2026-10-24T13:45:00Z", "iso")).toBe("2026-10-24");
    expect(parseDateLoose("10/24/2026", "mdy")).toBe("2026-10-24");
    expect(parseDateLoose("1-5-26", "mdy")).toBe("2026-01-05");
    expect(parseDateLoose("24/10/2026", "dmy")).toBe("2026-10-24");
    expect(parseDateLoose("24.10.2026 08:00", "dmy")).toBe("2026-10-24");
  });

  it("rejects impossible or misread dates", () => {
    expect(parseDateLoose("2026-02-30", "iso")).toBeNull();
    expect(parseDateLoose("13/01/2026", "mdy")).toBeNull(); // month 13: the wrong format was chosen
    expect(parseDateLoose("10/24/2026", "dmy")).toBeNull();
    expect(parseDateLoose("yesterday", "iso")).toBeNull();
    expect(parseDateLoose("", "iso")).toBeNull();
    expect(parseDateLoose("1850-01-01", "iso")).toBeNull();
  });
});

describe("guessMapping", () => {
  it("recognizes Actual Budget's export", () => {
    const g = guessMapping(["Account", "Date", "Payee", "Notes", "Category", "Amount", "Cleared"]);
    expect(g.isActual).toBe(true);
    expect(g.mapping).toEqual({
      account: 0,
      date: 1,
      payee: 2,
      notes: 3,
      category: 4,
      amount: 5,
      debit: null,
      credit: null,
      invertSigns: false,
    });
  });

  it("recognizes a bank export with debit and credit columns", () => {
    const g = guessMapping(["Posting Date", "Description", "Debit", "Credit", "Balance"]);
    expect(g.isActual).toBe(false);
    expect(g.mapping).toMatchObject({
      date: 0,
      payee: 1,
      debit: 2,
      credit: 3,
      amount: null,
      account: null,
      category: null,
    });
  });

  it("falls back to nulls when nothing is recognizable", () => {
    expect(guessMapping(["x", "y"]).mapping).toMatchObject({ date: 0, amount: null, payee: null });
  });
});

const ACTUAL: ColumnMapping = {
  account: 0,
  date: 1,
  payee: 2,
  notes: 3,
  category: 4,
  amount: 5,
  debit: null,
  credit: null,
  invertSigns: false,
};

describe("parseImportFile", () => {
  const csv = [
    "Account,Date,Payee,Notes,Category,Amount,Cleared",
    "Checking,2025-03-01,Landlord,March rent,Rent/Mortgage,-1800.00,true",
    'Checking,2025-03-02,"Cafe, Corner",,Dining,-4.50,true',
    "Savings,2025-03-03,Employer,,Income,2500.00,true",
    "Checking,not a date,Oops,,,-1.00,true",
    "Checking,2025-03-04,Bad amount,,,abc,true",
    "Checking,2025-03-05,Zero,,,0.00,true",
    "",
  ].join("\n");

  it("reads good rows and reports each bad one with its line number", () => {
    const f = parseImportFile(csv, true, "iso", ACTUAL);
    expect(f.dataRows).toBe(6);
    expect(f.rows).toEqual([
      {
        line: 2,
        accountLabel: "Checking",
        date: "2025-03-01",
        amountCents: -180000,
        payee: "Landlord",
        notes: "March rent",
        category: "Rent/Mortgage",
      },
      {
        line: 3,
        accountLabel: "Checking",
        date: "2025-03-02",
        amountCents: -450,
        payee: "Cafe, Corner",
        notes: "",
        category: "Dining",
      },
      {
        line: 4,
        accountLabel: "Savings",
        date: "2025-03-03",
        amountCents: 250000,
        payee: "Employer",
        notes: "",
        category: "Income",
      },
    ]);
    expect(f.problems.map((p) => [p.line, p.message])).toEqual([
      [5, 'Couldn\'t read the date "not a date"'],
      [6, 'Couldn\'t read the amount "abc"'],
      [7, "The amount is zero"],
    ]);
    expect(accountLabels(f.rows)).toEqual(["Checking", "Savings"]);
  });

  it("handles files without a header or an account column", () => {
    const f = parseImportFile("3/1/2025,Coffee,-3.00\n3/2/2025,Pay,100", false, "mdy", {
      account: null,
      date: 0,
      payee: 1,
      notes: null,
      category: null,
      amount: 2,
      debit: null,
      credit: null,
      invertSigns: false,
    });
    expect(f.rows.map((r) => [r.line, r.date, r.amountCents, r.accountLabel])).toEqual([
      [1, "2025-03-01", -300, "(all rows)"],
      [2, "2025-03-02", 10000, "(all rows)"],
    ]);
    expect(f.headers).toEqual(["Column 1", "Column 2", "Column 3"]);
  });

  it("combines debit and credit columns", () => {
    const f = parseImportFile(
      "Date,Desc,Debit,Credit\n2025-03-01,Store,12.00,\n2025-03-02,Refund,,5.00\n2025-03-03,Neither,,",
      true,
      "iso",
      {
        account: null,
        date: 0,
        payee: 1,
        notes: null,
        category: null,
        amount: null,
        debit: 2,
        credit: 3,
        invertSigns: false,
      },
    );
    expect(f.rows.map((r) => r.amountCents)).toEqual([-1200, 500]);
    expect(f.problems).toHaveLength(1);
  });

  it("can invert signs for credit card exports that list charges as positive", () => {
    const f = parseImportFile("Date,Desc,Amount\n2025-03-01,Store,12.00\n2025-03-02,Payment,-50.00", true, "iso", {
      account: null,
      date: 0,
      payee: 1,
      notes: null,
      category: null,
      amount: 2,
      debit: null,
      credit: null,
      invertSigns: true,
    });
    expect(f.rows.map((r) => r.amountCents)).toEqual([-1200, 5000]);
  });

  it("refuses absurdly large files with one clear message", () => {
    const big = "Date,Amount\n" + Array.from({ length: 50_001 }, () => "2025-01-01,1").join("\n");
    const f = parseImportFile(big, true, "iso", {
      ...ACTUAL,
      account: null,
      payee: null,
      notes: null,
      category: null,
      date: 0,
      amount: 1,
    });
    expect(f.rows).toEqual([]);
    expect(f.problems[0].message).toContain("limit");
  });
});

describe("mappingProblem", () => {
  it("requires exactly one amount style", () => {
    expect(mappingProblem(ACTUAL)).toBeNull();
    expect(mappingProblem({ ...ACTUAL, amount: null })).toMatch(/Choose the amount/);
    expect(mappingProblem({ ...ACTUAL, debit: 6 })).toMatch(/not both/);
    expect(mappingProblem({ ...ACTUAL, amount: null, debit: 6, credit: 7 })).toBeNull();
  });
});

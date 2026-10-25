import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accounts, categories, transactions } from "@/db/schema";
import { zonedDayStart } from "@/lib/finance/dates";
import { setSplits } from "@/lib/finance/splits";
import { createRule } from "@/lib/rules/store";
import { commitImport, ImportError, previewImport } from "@/lib/import/plan";
import type { ImportRequest } from "@/lib/import/types";
import { addAccount, addTxn, categoryId, freshDb } from "../helpers/db";

const TZ = "UTC";
const at = (date: string) => zonedDayStart(date, TZ) + 12 * 3600;
const NOW = at("2026-10-24");

const HEADER = "Account,Date,Payee,Notes,Category,Amount,Cleared";
const request = (
  lines: string[],
  accountsMap: ImportRequest["accounts"],
  over: Partial<ImportRequest> = {},
): ImportRequest => ({
  csv: [HEADER, ...lines].join("\n"),
  hasHeader: true,
  dateFormat: "iso",
  mapping: {
    account: 0,
    date: 1,
    payee: 2,
    notes: 3,
    category: 4,
    amount: 5,
    debit: null,
    credit: null,
    invertSigns: false,
  },
  accounts: accountsMap,
  ...over,
});

/** SimpleFIN history starts 2026-09-01 in "chk". */
function dataset() {
  const db = freshDb();
  addAccount(db, "chk", { name: "Checking" });
  const t = (date: string, cents: number, description: string, over: object = {}) =>
    addTxn(db, "chk", { posted: at(date), amountCents: cents, description, ...over });
  const rent = t("2026-09-01", -180_000, "ZELLE TO LANDLORD");
  const coffee = t("2026-09-10", -450, "CAFE");
  const groceries = t("2026-09-15", -8_000, "SUPERMARKET", { categoryId: categoryId(db, "Groceries"), notes: "mine" });
  return { db, rent, coffee, groceries };
}
const map = { Checking: { type: "existing", accountId: "chk" } } as const;
const row = (db: ReturnType<typeof freshDb>, id: number) =>
  db.select().from(transactions).where(eq(transactions.id, id)).get()!;

describe("matching and inserting", () => {
  const lines = [
    "Checking,2026-09-02,Landlord,September rent,Rent/Mortgage,-1800.00,true", // matches rent (1 day off); fills category + notes
    "Checking,2026-09-10,Cafe,,Dining,-4.50,true", // matches coffee exactly; fills category
    "Checking,2026-09-15,Supermarket,from actual,Groceries,-80.00,true", // matches, but category and notes are already set
    "Checking,2026-09-20,Mystery,,Misc,-12.00,true", // inside synced history, no match -> skipped
    "Checking,2026-08-15,Old rent,Aug,Rent/Mortgage,-1800.00,true", // before the history -> inserted
    "Checking,2026-08-20,Paycheck,,Salary,2500.00,true", // before the history -> inserted; Salary is new and income-only
    "Checking,2026-08-21,Coffee,,Dining,-4.50,true", // before the history -> inserted
    "Savings,2026-08-01,Elsewhere,,,-1.00,true", // account not chosen -> skipped
    "Checking,2026-08-30,Bad,,,abc,true", // unreadable
  ];

  it("previews what each row would do without changing anything", () => {
    const { db } = dataset();
    const before = db.select().from(transactions).all().length;
    const p = previewImport(db, request(lines, map), TZ);
    expect(p).toMatchObject({ totalRows: 9, matches: 3, inserts: 3, skipped: 2, newAccounts: [] });
    expect(p.newCategories).toEqual(["Salary"]); // Misc only appears on a skipped row
    expect(p.problems).toEqual([{ line: 10, message: 'Couldn\'t read the amount "abc"' }]);
    expect(p.skipReasons.map((r) => r.count).sort()).toEqual([1, 1]);
    expect(p.sample.filter((r) => r.action === "match").map((r) => [r.payee, r.fills])).toEqual([
      ["Landlord", ["category", "notes"]],
      ["Cafe", ["category"]],
      ["Supermarket", []],
    ]);
    expect(db.select().from(transactions).all()).toHaveLength(before);
  });

  it("commits: fills empty fields on matches, inserts older rows as source=import, creates categories", () => {
    const { db, rent, coffee, groceries } = dataset();
    const r = commitImport(db, request(lines, map), NOW, TZ);
    expect(r).toMatchObject({ inserted: 3, updated: 2, categoriesCreated: 1, accountsCreated: 0 });

    const rentRow = row(db, rent.id);
    expect(rentRow).toMatchObject({
      categoryId: categoryId(db, "Rent/Mortgage"),
      notes: "September rent",
      description: "ZELLE TO LANDLORD",
      source: "simplefin",
    });
    expect(row(db, coffee.id).categoryId).toBe(categoryId(db, "Dining"));
    expect(row(db, groceries.id)).toMatchObject({ categoryId: categoryId(db, "Groceries"), notes: "mine" }); // never overwritten

    const imported = db.select().from(transactions).where(eq(transactions.source, "import")).all();
    expect(
      imported
        .map((t) => [t.amountCents, t.description, t.isReviewed])
        .sort((a, b) => (a[0] as number) - (b[0] as number)),
    ).toEqual([
      [-180_000, "Old rent", true],
      [-450, "Coffee", true],
      [250_000, "Paycheck", true],
    ]);
    expect(imported.every((t) => t.accountId === "chk" && t.sfTxnId.startsWith("import-"))).toBe(true);
    const salary = db.select().from(categories).where(eq(categories.name, "Salary")).get()!;
    expect(salary.isIncome).toBe(true); // only ever received money
    expect(imported.find((t) => t.description === "Paycheck")?.categoryId).toBe(salary.id);
    expect(
      db
        .select()
        .from(categories)
        .all()
        .some((c) => c.name === "Misc"),
    ).toBe(false);
  });

  it("is safe to run twice: the second run finds everything already there", () => {
    const { db } = dataset();
    commitImport(db, request(lines, map), NOW, TZ);
    const total = db.select().from(transactions).all().length;
    const again = commitImport(db, request(lines, map), NOW + 60, TZ);
    expect(again).toMatchObject({ inserted: 0, updated: 0, categoriesCreated: 0 });
    expect(db.select().from(transactions).all()).toHaveLength(total);
    expect(again.matches).toBe(6); // 3 original matches + the 3 rows imported the first time
  });
});

describe("matching rules", () => {
  it("pairs each file row with one distinct existing transaction, nearest date first", () => {
    const db = freshDb();
    addAccount(db, "chk");
    const a = addTxn(db, "chk", { posted: at("2026-09-10"), amountCents: -500, description: "A" });
    const b = addTxn(db, "chk", { posted: at("2026-09-12"), amountCents: -500, description: "B" });
    const lines = [
      "Checking,2026-09-11,x,n1,,-5.00,true",
      "Checking,2026-09-11,y,n2,,-5.00,true",
      "Checking,2026-09-11,z,n3,,-5.00,true",
    ];
    const r = commitImport(db, request(lines, map), NOW, TZ);
    expect(r).toMatchObject({ matches: 2, updated: 2 });
    expect([row(db, a.id).notes, row(db, b.id).notes]).toEqual(["n1", "n2"]); // third row has nothing left to match
    expect(r.skipped).toBe(1); // inside history (history starts 09-10), not matched
  });

  it("matches within two days but not three, and only on the same amount", () => {
    const db = freshDb();
    addAccount(db, "chk");
    addTxn(db, "chk", { posted: at("2026-09-10"), amountCents: -500, description: "A" });
    const p = previewImport(
      db,
      request(
        [
          "Checking,2026-09-12,x,,,-5.00,true",
          "Checking,2026-09-13,x,,,-5.00,true",
          "Checking,2026-09-10,x,,,-5.01,true",
        ],
        map,
      ),
      TZ,
    );
    expect(p.sample.map((r) => r.action)).toEqual(["match", "skip", "skip"]);
    expect(p.matches).toBe(1);
  });

  it("never replaces a split with a single imported category", () => {
    const { db, groceries } = dataset();
    setSplits(db, groceries.id, {
      parts: [
        { categoryId: categoryId(db, "Groceries"), amountCents: -5_000 },
        { categoryId: categoryId(db, "Shopping"), amountCents: -3_000 },
      ],
    });
    const r = commitImport(db, request(["Checking,2026-09-15,Supermarket,,Dining,-80.00,true"], map), NOW, TZ);
    expect(r.updated).toBe(0);
    expect(row(db, groceries.id).categoryId).toBeNull();
  });

  it("uses local dates for matching", () => {
    const db = freshDb();
    addAccount(db, "chk");
    // 02:00 UTC on Sep 12 is still Sep 11 in New York
    const t = addTxn(db, "chk", {
      posted: zonedDayStart("2026-09-12", "UTC") + 2 * 3600,
      amountCents: -500,
      description: "A",
    });
    const p = previewImport(db, request(["Checking,2026-09-09,x,note,,-5.00,true"], map), "America/New_York");
    expect(p.matches).toBe(1); // 09-11 vs 09-09 = 2 days
    void t;
  });
});

describe("accounts", () => {
  it("creates new manual accounts for rows you send to one", () => {
    const db = freshDb();
    const lines = ["Old Bank,2025-01-02,Rent,,Rent/Mortgage,-900.00,true", "Old Bank,2025-01-05,Pay,,,1500.00,true"];
    const r = commitImport(db, request(lines, { "Old Bank": { type: "new", name: "Old Bank (imported)" } }), NOW, TZ);
    expect(r).toMatchObject({ inserted: 2, accountsCreated: 1, newAccounts: ["Old Bank (imported)"] });
    const acct = db.select().from(accounts).get()!;
    expect(acct).toMatchObject({ name: "Old Bank (imported)", isManual: true, connectionId: null, balanceCents: 0 });
    expect(
      db
        .select()
        .from(transactions)
        .all()
        .every((t) => t.accountId === acct.id && t.source === "import"),
    ).toBe(true);
  });

  it("skips accounts marked skip, unchosen ones and ones that no longer exist", () => {
    const { db } = dataset();
    const lines = [
      "Checking,2025-01-02,A,,,-1.00,true",
      "Other,2025-01-02,B,,,-2.00,true",
      "Gone,2025-01-02,C,,,-3.00,true",
    ];
    const p = previewImport(
      db,
      request(lines, { Checking: { type: "skip" }, Gone: { type: "existing", accountId: "deleted" } }),
      TZ,
    );
    expect(p).toMatchObject({ inserts: 0, skipped: 3 });
    expect(p.skipReasons.map((s) => s.reason).sort()).toEqual([
      "No account chosen",
      "That account no longer exists",
      "You chose to skip this account",
    ]);
  });
});

describe("other behavior", () => {
  it("runs rules over imported rows that came without a category and pairs transfers across accounts", () => {
    const db = freshDb();
    addAccount(db, "chk");
    addAccount(db, "sav");
    createRule(db, {
      name: "Rent",
      conditions: [{ field: "description", op: "contains", value: "landlord" }],
      actions: { categoryId: categoryId(db, "Rent/Mortgage") },
    });
    const lines = [
      "A,2025-01-02,Landlord,,,-900.00,true",
      "A,2025-01-03,To savings,,,-200.00,true",
      "B,2025-01-03,From checking,,,200.00,true",
    ];
    commitImport(
      db,
      request(lines, { A: { type: "existing", accountId: "chk" }, B: { type: "existing", accountId: "sav" } }),
      NOW,
      TZ,
    );
    const all = db.select().from(transactions).all();
    expect(all.find((t) => t.description === "Landlord")?.categoryId).toBe(categoryId(db, "Rent/Mortgage"));
    expect(
      all
        .filter((t) => t.isTransfer)
        .map((t) => t.amountCents)
        .sort((a, b) => a - b),
    ).toEqual([-20_000, 20_000]);
  });

  it("works with a plain file: no account column, a header-less layout and debit/credit columns", () => {
    const db = freshDb();
    addAccount(db, "chk");
    const r = commitImport(
      db,
      {
        csv: "03/01/2025,Store,12.00,\n03/02/2025,Refund,,5.00",
        hasHeader: false,
        dateFormat: "mdy",
        mapping: {
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
        accounts: { "(all rows)": { type: "existing", accountId: "chk" } },
      },
      NOW,
      TZ,
    );
    expect(r.inserted).toBe(2);
    expect(
      db
        .select()
        .from(transactions)
        .all()
        .map((t) => t.amountCents)
        .sort((a, b) => a - b),
    ).toEqual([-1200, 500]);
  });

  it("rejects an unusable mapping and an empty file", () => {
    const db = freshDb();
    expect(() =>
      previewImport(
        db,
        request(
          [],
          {},
          {
            mapping: {
              account: 0,
              date: 1,
              payee: 2,
              notes: null,
              category: null,
              amount: null,
              debit: null,
              credit: null,
              invertSigns: false,
            },
          },
        ),
        TZ,
      ),
    ).toThrow(ImportError);
    expect(() => previewImport(db, { ...request([], {}), csv: "" }, TZ)).toThrow();
  });

  it("keeps identical rows as separate transactions with stable ids", () => {
    const db = freshDb();
    addAccount(db, "chk");
    const lines = ["Checking,2025-01-02,Coffee,,,-3.00,true", "Checking,2025-01-02,Coffee,,,-3.00,true"];
    commitImport(db, request(lines, map), NOW, TZ);
    expect(db.select().from(transactions).all()).toHaveLength(2);
    expect(
      new Set(
        db
          .select()
          .from(transactions)
          .all()
          .map((t) => t.sfTxnId),
      ).size,
    ).toBe(2);
  });
});

/**
 * Development helper: fills the database with ~10,000 realistic fake transactions across three
 * accounts so the register, charts and performance can be exercised without a bank.
 *
 *   pnpm db:seed-fake            replace previous fake data
 *   pnpm db:seed-fake --setup    also set a dev password ("password1234") and mark setup complete
 *
 * Fake accounts have ids starting with "fake-" and no connection, so syncing never touches them.
 */
import argon2 from "argon2";
import { eq, like } from "drizzle-orm";
import { runMigrations } from "./migrate";
import { createDb, openSqlite } from "./open";
import { paletteColor } from "./palette";
import { accounts, balanceSnapshots, categories, settings, tags, transactionTags, transactions } from "./schema";
import { localDateString } from "../lib/finance/dates";

const DAY = 86_400;
const TARGET_TXNS = 10_000;
/** Scales merchant prices down so a month of ~14 purchases a day still fits a plausible income. */
const SPEND_SCALE = 0.3;

/** Small deterministic PRNG so the dataset is identical on every run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Merchant {
  name: string;
  category: string;
  min: number;
  max: number;
  weight: number;
}

const MERCHANTS: Merchant[] = [
  { name: "TRADER JOE'S #552", category: "Groceries", min: 25, max: 140, weight: 10 },
  { name: "WHOLE FOODS MARKET", category: "Groceries", min: 30, max: 180, weight: 8 },
  { name: "SAFEWAY #1411", category: "Groceries", min: 15, max: 120, weight: 6 },
  { name: "SQ *BLUE BOTTLE COFFEE", category: "Dining", min: 4, max: 12, weight: 12 },
  { name: "CHIPOTLE 1842", category: "Dining", min: 9, max: 18, weight: 8 },
  { name: "DOORDASH*THAI HOUSE", category: "Dining", min: 22, max: 60, weight: 7 },
  { name: "SHAKE SHACK", category: "Dining", min: 12, max: 35, weight: 4 },
  { name: "UBER *TRIP", category: "Transport", min: 8, max: 45, weight: 7 },
  { name: "SHELL OIL 57444", category: "Transport", min: 30, max: 70, weight: 5 },
  { name: "CLIPPER SYSTEMS", category: "Transport", min: 10, max: 40, weight: 3 },
  { name: "AMAZON MKTPLACE PMTS", category: "Shopping", min: 8, max: 220, weight: 12 },
  { name: "TARGET 00012345", category: "Shopping", min: 12, max: 150, weight: 6 },
  { name: "BEST BUY 000123", category: "Shopping", min: 30, max: 600, weight: 1 },
  { name: "NETFLIX.COM", category: "Subscriptions", min: 15.49, max: 15.49, weight: 0 },
  { name: "SPOTIFY USA", category: "Subscriptions", min: 11.99, max: 11.99, weight: 0 },
  { name: "CVS/PHARMACY #9921", category: "Health", min: 6, max: 80, weight: 3 },
  { name: "AMC THEATRES 1012", category: "Entertainment", min: 14, max: 45, weight: 2 },
  { name: "DELTA AIR LINES", category: "Travel", min: 120, max: 650, weight: 0.5 },
  { name: "AIRBNB * HM4K2", category: "Travel", min: 90, max: 700, weight: 0.4 },
  { name: "ETSY.COM", category: "Gifts", min: 15, max: 90, weight: 1 },
  { name: "MONTHLY MAINTENANCE FEE", category: "Fees", min: 6, max: 6, weight: 0 },
];

const cents = (dollars: number) => Math.round(dollars * 100);

async function main() {
  const file = process.env.DATABASE_PATH ?? "./data/simplebudget.db";
  const withSetup = process.argv.includes("--setup");
  const sqlite = openSqlite(file);
  const db = createDb(sqlite);
  runMigrations(db);

  const rand = mulberry32(42);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const now = Math.floor(Date.now() / 1000);
  const cats = new Map(
    db
      .select()
      .from(categories)
      .all()
      .map((c) => [c.name, c.id]),
  );

  const tagNames = ["vacation", "reimbursable", "gift", "tax"];
  const tagIds = tagNames.map((name, i) => {
    const existing = db
      .select()
      .from(tags)
      .all()
      .find((t) => t.name === name);
    return (
      existing?.id ??
      db
        .insert(tags)
        .values({ name, color: paletteColor(i) })
        .returning()
        .get().id
    );
  });

  db.delete(accounts).where(like(accounts.id, "fake-%")).run();

  type NewTxn = typeof transactions.$inferInsert;
  const byAccount: Record<string, NewTxn[]> = { "fake-checking": [], "fake-credit": [], "fake-savings": [] };
  let n = 0;
  /** Card purchases since the last autopay; the autopay settles exactly this, like a real statement balance. */
  let cardOwed = 0;
  const make = (accountId: string, ts: number, amount: number, description: string, extra: Partial<NewTxn> = {}) => {
    const row: NewTxn = {
      accountId,
      sfTxnId: `fake-${++n}`,
      posted: ts,
      amountCents: amount,
      description,
      rawJson: JSON.stringify({ id: `fake-${n}`, posted: ts, amount: (amount / 100).toFixed(2), description }),
      importedAt: now,
      updatedAt: now,
      ...extra,
    };
    byAccount[accountId].push(row);
    if (accountId === "fake-credit" && amount < 0) cardOwed -= amount;
    return row;
  };

  const days = 730;
  const start = now - days * DAY;
  const weights = MERCHANTS.reduce((s, m) => s + m.weight, 0);
  const pickMerchant = () => {
    let r = rand() * weights;
    for (const m of MERCHANTS) if ((r -= m.weight) <= 0) return m;
    return MERCHANTS[0];
  };

  for (let d = 0; d < days; d++) {
    const dayStart = start + d * DAY;
    const dow = new Date(dayStart * 1000).getUTCDay();
    const dom = new Date(dayStart * 1000).getUTCDate();
    const at = (h: number) => dayStart + Math.floor(h * 3600);

    if (d % 14 === 3)
      make("fake-checking", at(6), cents(4000), "ACME CORP PAYROLL DIRECT DEP", {
        categoryId: cats.get("Income"),
        payee: "ACME Corp",
      });
    if (dom === 1)
      make("fake-checking", at(9), -cents(1850), "ZELLE TO LANDLORD JANE", { categoryId: cats.get("Rent/Mortgage") });
    if (dom === 5)
      make("fake-credit", at(7), -cents(15.49), "NETFLIX.COM LOS GATOS CA", { categoryId: cats.get("Subscriptions") });
    if (dom === 9) make("fake-credit", at(7), -cents(11.99), "SPOTIFY USA", { categoryId: cats.get("Subscriptions") });
    if (dom === 12)
      make("fake-checking", at(8), -cents(between(90, 160)), "CITY UTILITIES BILL PAY", {
        categoryId: cats.get("Bills & Utilities"),
      });
    if (dom === 15 && d % 3 === 0)
      make("fake-checking", at(8), -6_00, "MONTHLY MAINTENANCE FEE", { categoryId: cats.get("Fees") });
    if (dom === 20) {
      // Card payment from checking, mirrored on the card, flagged as a paired transfer later.
      const amt = Math.max(cardOwed, 100);
      make("fake-checking", at(10), -amt, "CHASE CREDIT CRD AUTOPAY", { isTransfer: true });
      make("fake-credit", at(14), amt, "PAYMENT THANK YOU - WEB", { isTransfer: true });
      cardOwed = 0;
    }
    if (dom === 25) {
      const amt = cents(between(200, 600));
      byAccount["fake-savings"].push({
        accountId: "fake-savings",
        sfTxnId: `fake-${++n}`,
        posted: at(9),
        amountCents: amt,
        description: "ONLINE BANKING TRANSFER FROM CHK 5678",
        rawJson: "{}",
        importedAt: now,
        updatedAt: now,
        isTransfer: true,
      });
      byAccount["fake-checking"].push({
        accountId: "fake-checking",
        sfTxnId: `fake-${++n}`,
        posted: at(9),
        amountCents: -amt,
        description: "ONLINE BANKING TRANSFER TO SAV 1234",
        rawJson: "{}",
        importedAt: now,
        updatedAt: now,
        isTransfer: true,
      });
    }
    if (dom === 28)
      make("fake-savings", at(5), cents(between(3, 12)), "INTEREST PAID", { categoryId: cats.get("Income") });

    // Everyday spending: ~10k transactions overall means roughly 10 per day on weekdays/weekends.
    const perDay = Math.round(between(dow === 0 || dow === 6 ? 11 : 9, dow === 0 || dow === 6 ? 21 : 17));
    for (let i = 0; i < perDay; i++) {
      const m = pickMerchant();
      const amt = -Math.max(cents(between(m.min, m.max) * SPEND_SCALE), 50);
      const onCard = rand() < 0.72;
      const categorized = rand() < 0.7;
      make(
        onCard ? "fake-credit" : "fake-checking",
        at(between(7, 22)),
        amt,
        `${m.name}${rand() < 0.3 ? ` ${pick(["AUSTIN TX", "SAN FRANCISCO CA", "BROOKLYN NY"])}` : ""}`,
        {
          categoryId: categorized ? cats.get(m.category) : undefined,
          isReviewed: rand() < 0.5,
          transactedAt: rand() < 0.5 ? at(between(7, 22)) - DAY : null,
        },
      );
    }
  }

  // Trim to the target size by dropping the oldest everyday rows, so the dataset is exactly ~10k.
  let total = Object.values(byAccount).reduce((s, l) => s + l.length, 0);
  for (const list of Object.values(byAccount)) list.sort((a, b) => a.posted - b.posted);
  while (total > TARGET_TXNS) {
    const biggest = Object.values(byAccount).sort((a, b) => b.length - a.length)[0];
    biggest.shift();
    total--;
  }

  // A few pending items in the last two days (not part of the balance).
  for (const [accountId, label] of [
    ["fake-credit", "UBER *TRIP"],
    ["fake-credit", "SQ *BLUE BOTTLE COFFEE"],
    ["fake-checking", "WHOLE FOODS #123"],
  ] as const) {
    byAccount[accountId].push({
      accountId,
      sfTxnId: `fake-${++n}`,
      posted: 0,
      pending: true,
      transactedAt: now - Math.floor(between(0.2, 1.5) * DAY),
      amountCents: -cents(between(5, 80)),
      description: label,
      rawJson: "{}",
      importedAt: now,
      updatedAt: now,
    });
  }

  const targets: Record<string, { name: string; type: "checking" | "credit" | "savings"; balance: number }> = {
    "fake-checking": { name: "Total Checking", type: "checking", balance: cents(4823.17) },
    "fake-credit": { name: "Sapphire Credit Card", type: "credit", balance: -cents(1234.56) },
    "fake-savings": { name: "High Yield Savings", type: "savings", balance: cents(10300) },
  };

  db.transaction((tx) => {
    let order = 0;
    for (const [id, t] of Object.entries(targets)) {
      tx.insert(accounts)
        .values({
          id,
          orgName: "Fake Bank",
          name: t.name,
          type: t.type,
          balanceCents: t.balance,
          balanceDate: now,
          sortOrder: order++,
        })
        .run();
      const rows = byAccount[id];
      for (let i = 0; i < rows.length; i += 400)
        tx.insert(transactions)
          .values(rows.slice(i, i + 400))
          .run();

      // Daily snapshots for the last 120 days, walking back from today's balance.
      const posted = rows.filter((r) => !r.pending).sort((a, b) => b.posted - a.posted);
      let balance = t.balance;
      let cursor = 0;
      for (let back = 0; back < 120; back++) {
        const dayEnd = now - back * DAY;
        while (cursor < posted.length && posted[cursor].posted > dayEnd) balance -= posted[cursor++].amountCents;
        tx.insert(balanceSnapshots)
          .values({ accountId: id, date: localDateString(dayEnd, "UTC"), balanceCents: balance })
          .onConflictDoNothing()
          .run();
      }
    }

    // Investment accounts have no transactions, only balances that drift upward over time. The brokerage was
    // added 45 days ago, so net worth history must not dip to zero before it existed.
    for (const [id, name, balance, history] of [
      ["fake-ira", "Roth IRA", cents(42_150), 120],
      ["fake-brokerage", "Brokerage", cents(8_420.55), 45],
    ] as const) {
      tx.insert(accounts)
        .values({
          id,
          orgName: "Fake Brokerage",
          name,
          type: "investment",
          balanceCents: balance,
          balanceDate: now,
          sortOrder: order++,
        })
        .run();
      let value = balance;
      for (let back = 0; back < history; back++) {
        tx.insert(balanceSnapshots)
          .values({ accountId: id, date: localDateString(now - back * DAY, "UTC"), balanceCents: Math.round(value) })
          .onConflictDoNothing()
          .run();
        value /= 1 + between(-0.004, 0.0065); // walking backwards: drift up going forward
      }
    }

    // Pair the autopay transfers, and tag a sprinkling of transactions.
    const all = tx
      .select({
        id: transactions.id,
        desc: transactions.description,
        posted: transactions.posted,
        amt: transactions.amountCents,
        acc: transactions.accountId,
      })
      .from(transactions)
      .where(like(transactions.accountId, "fake-%"))
      .all();
    const outs = all.filter((r) => r.desc === "CHASE CREDIT CRD AUTOPAY");
    const ins = new Map(all.filter((r) => r.desc === "PAYMENT THANK YOU - WEB").map((r) => [r.amt, r]));
    for (const o of outs) {
      const i = ins.get(-o.amt);
      if (!i) continue;
      tx.update(transactions).set({ transferPairId: i.id }).where(eq(transactions.id, o.id)).run();
      tx.update(transactions).set({ transferPairId: o.id }).where(eq(transactions.id, i.id)).run();
    }
    const taggable = all.filter((r) => r.amt < 0 && !r.desc.includes("AUTOPAY"));
    for (let i = 0; i < taggable.length; i += 37) {
      tx.insert(transactionTags)
        .values({ transactionId: taggable[i].id, tagId: tagIds[i % tagIds.length] })
        .onConflictDoNothing()
        .run();
    }
  });

  if (withSetup) {
    // Dev convenience only: lets you log straight in as "password1234".
    const hash = await argon2.hash("password1234", { type: argon2.argon2id });
    for (const [key, value] of [
      ["password_hash", hash],
      ["setup_complete", "1"],
    ]) {
      db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    }
  }

  sqlite.close();
  console.log(`Seeded ${total + 3} fake transactions into ${file}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

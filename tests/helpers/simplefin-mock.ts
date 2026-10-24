import fs from "node:fs";
import path from "node:path";

export const NOW = 1792843200; // 2026-10-24T12:00:00Z
export const DAY = 86_400;
export const ACCESS_URL = "https://user:secret@bank.test/simplefin";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function loadFixture(name: "checking" | "credit-card" | "savings"): Json {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, `../fixtures/${name}.json`), "utf8"));
}

/** `shiftSeconds` moves every timestamp so the fixtures look recent no matter when the tests run. */
export function loadAllFixtures(shiftSeconds = 0): Json[] {
  const shift = (n: unknown) => (typeof n === "number" && n > 0 ? n + shiftSeconds : n);
  return (["checking", "credit-card", "savings"] as const).map((name) => {
    const a = loadFixture(name);
    a["balance-date"] = shift(a["balance-date"]);
    a.transactions = a.transactions.map((t: Json) => ({
      ...t,
      posted: shift(t.posted),
      ...(t.transacted_at ? { transacted_at: shift(t.transacted_at) } : {}),
    }));
    return a;
  });
}

export interface MockBank {
  accounts: Json[];
  errors: string[];
  /** Status to return instead of 200 (e.g. 403). */
  status?: number;
  calls: URL[];
  fetch: typeof fetch;
}

/** A SimpleFIN server stand-in that filters transactions by date range like the real Bridge does. */
export function mockBank(accounts: Json[] = loadAllFixtures()): MockBank {
  const bank: MockBank = {
    accounts,
    errors: [],
    calls: [],
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      bank.calls.push(url);
      if (bank.status && bank.status !== 200) return new Response("", { status: bank.status });
      const start = Number(url.searchParams.get("start-date") ?? 0);
      const end = Number(url.searchParams.get("end-date") ?? Number.MAX_SAFE_INTEGER);
      const withPending = url.searchParams.get("pending") === "1";
      const balancesOnly = url.searchParams.get("balances-only") === "1";
      const wanted = url.searchParams.getAll("account");
      const out = bank.accounts
        .filter((a) => wanted.length === 0 || wanted.includes(a.id))
        .map((a) => {
          const { transactions, ...rest } = a;
          if (balancesOnly) return rest;
          const filtered = (transactions ?? []).filter((t: Json) => {
            if (t.pending && !withPending) return false;
            const when = t.posted || t.transacted_at || 0;
            return when >= start && when < end;
          });
          return { ...rest, transactions: filtered };
        });
      return new Response(JSON.stringify({ errors: bank.errors, accounts: out }), { status: 200 });
    }) as typeof fetch,
  };
  return bank;
}

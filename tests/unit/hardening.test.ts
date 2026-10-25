import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { isCrossSiteMutation } from "@/lib/auth/csrf";
import { backupName, listBackups, pruneBackups, runBackup } from "@/lib/backup/backups";
import { createLogger, scrub } from "@/lib/logger";
import { addAccount, addTxn, freshDb } from "../helpers/db";

const h = (init: Record<string, string>) => new Headers(init);

describe("isCrossSiteMutation", () => {
  it("lets safe methods through whatever the origin", () => {
    expect(isCrossSiteMutation("GET", h({ origin: "https://evil.example" }), "budget.home")).toBe(false);
    expect(isCrossSiteMutation("HEAD", h({}), "budget.home")).toBe(false);
  });

  it("accepts a same-origin Origin, also via a proxy's forwarded host", () => {
    expect(isCrossSiteMutation("POST", h({ origin: "https://budget.home", host: "budget.home" }), "budget.home")).toBe(
      false,
    );
    expect(isCrossSiteMutation("DELETE", h({ origin: "http://localhost:3000" }), "localhost:3000")).toBe(false);
    expect(
      isCrossSiteMutation(
        "PUT",
        h({ origin: "https://budget.example.com", host: "127.0.0.1:3000", "x-forwarded-host": "budget.example.com" }),
        "127.0.0.1:3000",
      ),
    ).toBe(false);
  });

  it("refuses another origin, a null origin, a different port and junk", () => {
    expect(isCrossSiteMutation("POST", h({ origin: "https://evil.example", host: "budget.home" }), "budget.home")).toBe(
      true,
    );
    expect(isCrossSiteMutation("POST", h({ origin: "null" }), "budget.home")).toBe(true);
    expect(
      isCrossSiteMutation("PATCH", h({ origin: "https://budget.home:8443", host: "budget.home" }), "budget.home"),
    ).toBe(true);
    expect(isCrossSiteMutation("POST", h({ origin: "not a url" }), "budget.home")).toBe(true);
  });

  it("without Origin, trusts only same-origin fetch metadata or plain tools", () => {
    expect(isCrossSiteMutation("POST", h({ "sec-fetch-site": "cross-site" }), "budget.home")).toBe(true);
    expect(isCrossSiteMutation("POST", h({ "sec-fetch-site": "same-site" }), "budget.home")).toBe(true);
    expect(isCrossSiteMutation("POST", h({ "sec-fetch-site": "same-origin" }), "budget.home")).toBe(false);
    expect(isCrossSiteMutation("POST", h({}), "budget.home")).toBe(false); // curl and friends still need the session cookie
  });
});

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, logger: createLogger({ level: "info", destination: stream }) };
}

describe("logger redaction", () => {
  it("never writes secrets held in known fields", () => {
    const { lines, logger } = capture();
    logger.info(
      {
        apiKey: "sk-ant-supersecret123",
        password: "hunter2",
        user: { accessUrl: "https://u:p@bridge.test", token: "abc" },
        req: { headers: { cookie: "sb_session=xyz", authorization: "Bearer q" } },
      },
      "event",
    );
    const out = lines.join("");
    for (const secret of ["supersecret123", "hunter2", "u:p@", "abc", "sb_session=xyz", "Bearer q"])
      expect(out).not.toContain(secret);
    expect(out).toContain("[redacted]");
    expect(out).toContain('"msg":"event"');
  });

  it("scrubs credentials that appear inside messages and errors", () => {
    const { lines, logger } = capture();
    logger.error(
      { err: new Error("failed to fetch https://demo:s3cret@bridge.simplefin.org/simplefin/accounts") },
      "sync failed for https://demo:s3cret@bridge.simplefin.org/x",
    );
    logger.warn("key sk-ant-abcdefghij12345 rejected");
    const out = lines.join("");
    expect(out).not.toContain("s3cret");
    expect(out).not.toContain("abcdefghij12345");
    expect(out).toContain("bridge.simplefin.org");
  });

  it("scrub leaves ordinary text alone", () => {
    expect(scrub("fetched https://example.com/path?x=1 ok")).toBe("fetched https://example.com/path?x=1 ok");
  });
});

describe("backups", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sb-backups-"));
  const T0 = Date.UTC(2026, 9, 1, 3, 30, 0) / 1000;

  it("names files by UTC time so they sort chronologically", () => {
    expect(backupName(T0)).toBe("simplebudget-20261001-033000.sqlite");
    expect(backupName(T0 + 86_400) > backupName(T0)).toBe(true);
  });

  it("writes a restorable copy and keeps only the newest N", () => {
    const dir = tmp();
    try {
      const db = freshDb();
      addAccount(db, "A");
      addTxn(db, "A", { description: "Keep me", amountCents: -100 });
      for (let i = 0; i < 20; i++) runBackup(db, dir, T0 + i * 86_400, 14);
      const files = listBackups(dir);
      expect(files).toHaveLength(14);
      expect(files[0].name).toBe(backupName(T0 + 19 * 86_400)); // newest first
      expect(files.at(-1)?.name).toBe(backupName(T0 + 6 * 86_400));
      expect(fs.readdirSync(dir).filter((n) => n.endsWith(".partial"))).toEqual([]);
      expect(fs.readFileSync(path.join(dir, files[0].name)).subarray(0, 15).toString()).toBe("SQLite format 3");
      expect((fs.statSync(path.join(dir, files[0].name)).mode & 0o777).toString(8)).toBe("600");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("only ever deletes files it named itself", () => {
    const dir = tmp();
    try {
      fs.writeFileSync(path.join(dir, "notes.txt"), "mine");
      fs.writeFileSync(path.join(dir, "simplebudget-old.sqlite"), "mine too");
      for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(dir, backupName(T0 + i)), "x");
      expect(pruneBackups(dir, 1)).toHaveLength(2);
      expect(fs.readdirSync(dir).sort()).toEqual(["notes.txt", backupName(T0 + 2), "simplebudget-old.sqlite"].sort());
      expect(listBackups(path.join(dir, "missing"))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

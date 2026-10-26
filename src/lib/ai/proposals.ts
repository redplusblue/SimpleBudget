import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DbLike } from "@/db/open";
import { aiProposals } from "@/db/schema";
import { proposalPreview, ruleProposalPayload, type ProposalPreview, type RuleProposalPayload } from "./proposal-types";

export class ProposalError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

type Row = typeof aiProposals.$inferSelect;
export type NewProposal = typeof aiProposals.$inferInsert;

export interface StoredRuleProposal {
  row: Row;
  payload: RuleProposalPayload;
  preview: ProposalPreview | null;
}

export function insertProposals(db: DbLike, rows: NewProposal[]): void {
  if (rows.length === 0) return;
  db.insert(aiProposals).values(rows).run();
}

function parseRow(row: Row): StoredRuleProposal | null {
  try {
    const payload = ruleProposalPayload.parse(JSON.parse(row.payloadJson));
    const preview = row.previewJson ? proposalPreview.safeParse(JSON.parse(row.previewJson)) : null;
    return { row, payload, preview: preview?.success ? preview.data : null };
  } catch {
    return null;
  }
}

/** Rule proposals, newest first (max 200). Rows whose payload no longer parses are skipped. */
export function listProposals(
  db: DbLike,
  opts: { kind?: Row["kind"]; status?: Row["status"] | Row["status"][]; limit?: number } = {},
): StoredRuleProposal[] {
  const statuses = opts.status === undefined ? undefined : Array.isArray(opts.status) ? opts.status : [opts.status];
  return db
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.kind, opts.kind ?? "rule"), statuses ? inArray(aiProposals.status, statuses) : undefined))
    .orderBy(desc(aiProposals.createdAt), desc(aiProposals.id))
    .limit(Math.min(opts.limit ?? 200, 200))
    .all()
    .flatMap((r) => parseRow(r) ?? []);
}

export function getProposal(db: DbLike, id: number): StoredRuleProposal {
  const row = db.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  const parsed = row && parseRow(row);
  if (!parsed) throw new ProposalError("not_found", "Suggestion not found");
  return parsed;
}

/** Subject keys that already have a pending, dismissed or no_match proposal: each merchant is asked once. */
export function hasProposalFor(db: DbLike, subjectKeys: string[]): Set<string> {
  const found = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < subjectKeys.length; i += CHUNK) {
    const rows = db
      .select({ key: aiProposals.subjectKey })
      .from(aiProposals)
      .where(
        and(
          inArray(aiProposals.subjectKey, subjectKeys.slice(i, i + CHUNK)),
          inArray(aiProposals.status, ["pending", "dismissed", "no_match"]),
        ),
      )
      .all();
    for (const r of rows) if (r.key) found.add(r.key);
  }
  return found;
}

export function dismissProposal(db: DbLike, id: number, now: number): void {
  const p = getProposal(db, id);
  if (p.row.status !== "pending") throw new ProposalError("conflict", "This suggestion was already handled.");
  db.update(aiProposals).set({ status: "dismissed", resolvedAt: now }).where(eq(aiProposals.id, id)).run();
}

/** Deletes a dismissed or no_match row so the merchant can be asked about again. */
export function forgetProposal(db: DbLike, id: number): void {
  const row = db.select().from(aiProposals).where(eq(aiProposals.id, id)).get();
  if (!row) throw new ProposalError("not_found", "Suggestion not found");
  if (row.status !== "dismissed" && row.status !== "no_match")
    throw new ProposalError("conflict", "Only dismissed suggestions can be asked again.");
  db.delete(aiProposals).where(eq(aiProposals.id, id)).run();
}

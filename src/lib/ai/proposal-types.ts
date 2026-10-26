import { z } from "zod";

// Client-safe: shared by the proposals API and the Rules page.

export const ruleProposalPayload = z.object({
  merchant: z.object({
    key: z.string(),
    name: z.string(),
    sample: z.string(),
    direction: z.enum(["expense", "income"]),
    count: z.number().int(),
    medianCents: z.number().int(),
  }),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("category"), categoryId: z.number().int().positive(), categoryName: z.string() }),
    z.object({ type: z.literal("tag"), tagId: z.number().int().positive(), tagName: z.string() }),
  ]),
  pattern: z.object({ op: z.enum(["equals", "contains"]), value: z.string().min(1).max(300) }),
  target: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("extend"), ruleId: z.number().int(), ruleName: z.string() }),
    z.object({ mode: z.literal("new"), ruleName: z.string() }),
  ]),
});
export type RuleProposalPayload = z.infer<typeof ruleProposalPayload>;
export type RuleAction = RuleProposalPayload["action"];

export const proposalPreview = z.object({
  matched: z.number().int(),
  wouldChange: z.number().int(),
  conflicts: z.number().int(),
  conflictSamples: z.array(z.object({ date: z.string(), payee: z.string(), category: z.string() })).max(3),
});
export type ProposalPreview = z.infer<typeof proposalPreview>;

export type Confidence = "low" | "medium" | "high";

export const memoryProposalPayload = z.object({ text: z.string().min(1).max(300) });
export type MemoryProposalPayload = z.infer<typeof memoryProposalPayload>;

export const targetProposalPayload = z.object({
  categoryId: z.number().int().positive(),
  categoryName: z.string(),
  amountCents: z.number().int().positive(),
});
export type TargetProposalPayload = z.infer<typeof targetProposalPayload>;

interface ProposalViewBase {
  id: number;
  status: "pending" | "accepted" | "dismissed" | "no_match" | "stale";
  confidence: Confidence | null;
  model: string | null;
  createdAt: number;
  /** The conversation that produced it, if any. */
  threadId: number | null;
  /** False when what it points at (category, tag) has been deleted or archived. */
  stillValid: boolean;
  problem?: string;
}

/** A rule suggestion (from the suggestion job or the assistant). */
export interface ProposalView extends ProposalViewBase {
  kind: "rule";
  payload: RuleProposalPayload;
  preview: ProposalPreview | null;
}
export interface MemoryProposalView extends ProposalViewBase {
  kind: "memory";
  payload: MemoryProposalPayload;
}
export interface TargetProposalView extends ProposalViewBase {
  kind: "target";
  payload: TargetProposalPayload;
}
export type AnyProposalView = ProposalView | MemoryProposalView | TargetProposalView;

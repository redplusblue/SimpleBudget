import type { RuleProposalPayload } from "@/lib/ai/proposal-types";

export const payload = (name = "Blue Bottle Coffee"): RuleProposalPayload => ({
  merchant: {
    key: "expense:bluebottlecoffee",
    name,
    sample: "SQ *BLUE BOTTLE #1",
    direction: "expense",
    count: 3,
    medianCents: 500,
  },
  action: { type: "category", categoryId: 1, categoryName: "Dining" },
  pattern: { op: "equals", value: name },
  target: { mode: "new", ruleName: "AI · Dining" },
});

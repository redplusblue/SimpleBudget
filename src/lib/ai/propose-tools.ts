import "server-only";
import { z } from "zod";
import type { DbLike } from "@/db/open";
import { normalizePayee, payeeKey } from "@/lib/finance/payee";
import { listTargets } from "@/lib/finance/targets";
import { MAX_TARGET_CENTS } from "@/lib/finance/targets-types";
import { queryTransactions } from "@/lib/finance/transactions-query";
import { listCategoryChoices } from "@/lib/llm/categorize";
import type { LlmTool } from "@/lib/llm/types";
import { listRules } from "@/lib/rules/store";
import type { ProposeToolName } from "./lenses";
import { memoryText } from "./memory";
import type {
  AnyProposalView,
  MemoryProposalPayload,
  RuleProposalPayload,
  TargetProposalPayload,
} from "./proposal-types";
import { getProposalView, insertProposal } from "./proposals";
import { candidateRule, categoryAction, choosePattern } from "./rule-target";

// The assistant's only "write" tools. They create proposals the owner applies or dismisses; they are never part
// of LLM_TOOLS, so the read-only MCP server can't see them.

export const PROPOSE_TOOLS: Record<ProposeToolName, LlmTool> = {
  propose_rule: {
    name: "propose_rule",
    description:
      "Propose a categorization rule: transactions from this merchant get this category from now on. The owner must apply it; it does nothing by itself.",
    inputSchema: {
      type: "object",
      properties: {
        payee: { type: "string", description: "Merchant name as it appears in transactions, e.g. 'Blue Bottle'" },
        category: { type: "string", description: "Exact name of one of the owner's categories" },
        contains: {
          type: "string",
          description: "Optional shorter text (4+ letters) that identifies the same merchant",
        },
      },
      required: ["payee", "category"],
    },
  },
  propose_memory: {
    name: "propose_memory",
    description:
      "Propose remembering a lasting fact about the owner (e.g. 'Rent is paid to Acme on the 1st'). The owner must approve it.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "One short sentence, under 300 characters" } },
      required: ["text"],
    },
  },
  propose_target: {
    name: "propose_target",
    description:
      "Propose a monthly spending target for a category. The owner must apply it; it does nothing by itself.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Exact name of one of the owner's categories" },
        monthly_amount: { type: "number", description: "Dollars per month, above zero" },
      },
      required: ["category", "monthly_amount"],
    },
  },
};

export interface ProposeContext {
  threadId: number;
  model: string;
  runId: () => number | null;
  now: number;
  timeZone: string;
}

const ruleInput = z.object({
  payee: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(80),
  contains: z.string().trim().max(60).optional(),
});
const memoryInput = z.object({ text: memoryText });
const targetInput = z.object({ category: z.string().trim().min(1).max(80), monthly_amount: z.number().positive() });

const created = (what: string) =>
  `Proposal created: ${what}. The owner will see Apply and Dismiss buttons. Do not claim it is applied.`;

export function createProposeRunner(db: DbLike, ctx: ProposeContext, onProposal: (p: AnyProposalView) => void) {
  const findCategory = (name: string) =>
    listCategoryChoices(db).find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const base = {
    source: "assistant" as const,
    status: "pending" as const,
    model: ctx.model,
    threadId: ctx.threadId,
    createdAt: ctx.now,
  };
  const publish = (id: number) => onProposal(getProposalView(db, id, ctx.timeZone));

  return (name: string, input: unknown): string => {
    try {
      if (name === "propose_rule") {
        const { payee, category, contains } = ruleInput.parse(input);
        const cat = findCategory(category);
        if (!cat) return `No category named "${category}". Use the exact name of one of the owner's categories.`;

        const rows = queryTransactions(db, { q: payee }, { limit: 200, timeZone: ctx.timeZone }).rows;
        const groups = new Map<string, { name: string; sample: string; amounts: number[]; income: boolean }>();
        for (const r of rows) {
          const display = normalizePayee(r.displayPayee) || r.displayPayee;
          const direction = r.amountCents > 0 ? "income" : "expense";
          const key = `${direction}:${payeeKey(display) || "unknown"}`;
          const g = groups.get(key) ?? {
            name: display,
            sample: r.description,
            amounts: [],
            income: direction === "income",
          };
          g.amounts.push(Math.abs(r.amountCents));
          groups.set(key, g);
        }
        const best = [...groups.entries()].sort((a, b) => b[1].amounts.length - a[1].amounts.length)[0];
        if (!best) return `No transactions match "${payee}". Ask the owner for the merchant name as it appears.`;
        const [key, g] = best;
        const amounts = [...g.amounts].sort((a, b) => a - b);

        const action = categoryAction(cat.id, cat.name);
        const { pattern, preview } = choosePattern(db, { payee: g.name }, action, contains, ctx.timeZone);
        const draft: RuleProposalPayload = {
          merchant: {
            key,
            name: g.name,
            sample: g.sample,
            direction: g.income ? "income" : "expense",
            count: g.amounts.length,
            medianCents: amounts[Math.floor(amounts.length / 2)],
          },
          action,
          pattern,
          target: { mode: "new", ruleName: "" },
        };
        const { rule, mode } = candidateRule(listRules(db), draft);
        const payload: RuleProposalPayload = {
          ...draft,
          target: mode === "extend" ? { mode, ruleId: rule.id, ruleName: rule.name } : { mode, ruleName: rule.name },
        };
        publish(
          insertProposal(db, {
            ...base,
            kind: "rule",
            subjectKey: `category:${key}`,
            payloadJson: JSON.stringify(payload),
            previewJson: JSON.stringify(preview),
            aiRunId: ctx.runId(),
          }),
        );
        return created(
          `${mode === "extend" ? "add" : "new rule for"} payee ${pattern.op === "equals" ? "is" : "contains"} "${pattern.value}" → ${cat.name} (matches ${preview.matched}, fills ${preview.wouldChange}${preview.conflicts ? `, ${preview.conflicts} already categorized differently` : ""})`,
        );
      }

      if (name === "propose_memory") {
        const { text } = memoryInput.parse(input);
        const payload: MemoryProposalPayload = { text };
        publish(
          insertProposal(db, { ...base, kind: "memory", payloadJson: JSON.stringify(payload), aiRunId: ctx.runId() }),
        );
        return created(`remember "${text}"`);
      }

      if (name === "propose_target") {
        const { category, monthly_amount } = targetInput.parse(input);
        const cat = findCategory(category);
        if (!cat) return `No category named "${category}". Use the exact name of one of the owner's categories.`;
        const amountCents = Math.round(monthly_amount * 100);
        if (amountCents < 1 || amountCents > MAX_TARGET_CENTS) return "The amount must be above zero and realistic.";
        if (listTargets(db).some((t) => t.kind === "category" && t.subjectId === cat.id && t.month === null))
          return `A monthly target for ${cat.name} already exists. Ask the owner to change it on the Spending page.`;
        const payload: TargetProposalPayload = { categoryId: cat.id, categoryName: cat.name, amountCents };
        publish(
          insertProposal(db, { ...base, kind: "target", payloadJson: JSON.stringify(payload), aiRunId: ctx.runId() }),
        );
        return created(`monthly target for ${cat.name} of $${(amountCents / 100).toFixed(2)}`);
      }
    } catch (e) {
      if (e instanceof z.ZodError) return `Invalid input: ${e.issues[0]?.message ?? "check the arguments"}.`;
      throw e;
    }
    throw new Error(`Unknown tool: ${name}`);
  };
}

/**
 * Manual bulk job: asks your configured AI model to categorize transactions that have no category.
 * Costs money, so it never runs by itself. See docs/AI.md ("Bulk categorizing").
 *
 *   pnpm ai:categorize                         preview: ask the model, save proposals, write nothing to the budget
 *   pnpm ai:categorize --apply                 ask and write the confident answers
 *   pnpm ai:categorize --from proposals.json --apply     write a saved preview without calling the model again
 *
 * Options: --max-payees N (default 200)  --batch-size N (40)  --max-calls N (5)  --min-confidence low|medium|high (high)
 *          --make-rules (also create a payee rule per applied merchant)  --model NAME  --out FILE  --yes (skip the prompt)
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { getAiConfig, getApiKey, modelFor } from "../lib/llm/config";
import {
  CONFIDENCES,
  applyProposals,
  buildBatchPrompt,
  collectUncategorized,
  estimateTokens,
  listCategoryChoices,
  proposeCategories,
  SYSTEM_PROMPT,
  type Confidence,
  type Proposal,
} from "../lib/llm/categorize";
import { createOpenAiCompatibleClient } from "../lib/llm/openai-compatible";
import { trackRuns } from "../lib/llm/runs";
import { runMigrations } from "./migrate";
import { createDb, openSqlite } from "./open";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    from: { type: "string" },
    out: { type: "string", default: "./data/ai-categorize-proposals.json" },
    "max-payees": { type: "string", default: "200" },
    "batch-size": { type: "string", default: "40" },
    "max-calls": { type: "string", default: "5" },
    "min-confidence": { type: "string", default: "high" },
    "make-rules": { type: "boolean", default: false },
    model: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

const positive = (name: string, v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive whole number`);
  return n;
};
const minConfidence = values["min-confidence"] as Confidence;
if (!CONFIDENCES.includes(minConfidence)) throw new Error(`--min-confidence must be one of ${CONFIDENCES.join(", ")}`);

async function main() {
  const file = process.env.DATABASE_PATH ?? "./data/simplebudget.db";
  const sqlite = openSqlite(file);
  const db = createDb(sqlite);
  runMigrations(db);
  try {
    let proposals: Proposal[];

    if (values.from) {
      proposals = JSON.parse(fs.readFileSync(values.from, "utf8")) as Proposal[];
      console.log(`Loaded ${proposals.length} saved proposals from ${values.from} (no model call).`);
    } else {
      const cfg = getAiConfig(db);
      const model = values.model ?? modelFor(cfg, "rules");
      if (!cfg.baseUrl || !model) throw new Error("Set the AI server address and model in Settings → AI first.");
      const choices = listCategoryChoices(db);
      const groups = collectUncategorized(db, { maxGroups: positive("max-payees", values["max-payees"]) });
      if (groups.length === 0) {
        console.log("Nothing to do: every eligible transaction already has a category.");
        return;
      }
      const batchSize = positive("batch-size", values["batch-size"]);
      const maxCalls = positive("max-calls", values["max-calls"]);
      const calls = Math.min(maxCalls, Math.ceil(groups.length / batchSize));
      const inTokens = Array.from({ length: calls }, (_, i) =>
        estimateTokens(SYSTEM_PROMPT + buildBatchPrompt(groups.slice(i * batchSize, (i + 1) * batchSize), choices)),
      ).reduce((a, b) => a + b, 0);
      console.log(
        `${groups.length} distinct payees (${groups.reduce((n, g) => n + g.count, 0)} transactions) are uncategorized.\n` +
          `Plan: ${calls} call(s) to ${model} at ${cfg.baseUrl}, about ${inTokens} input tokens.\n` +
          `Sent: cleaned payee names, one bank description each, typical amount, counts, and your category names. No account data.`,
      );
      if (!values.yes) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question("Continue? [y/N] ")).trim().toLowerCase();
        rl.close();
        if (answer !== "y" && answer !== "yes") return console.log("Cancelled; nothing was sent.");
      }
      const llm = trackRuns(db, createOpenAiCompatibleClient({ apiKey: getApiKey(db), model, baseUrl: cfg.baseUrl }), {
        feature: "rules",
        model,
        trigger: "manual",
        subject: "cli",
      });
      const result = await proposeCategories(llm, groups, choices, {
        batchSize,
        maxCalls,
        onBatch: (b) => console.log(`  call ${b.call}/${b.calls} (${b.groups} payees)...`),
      });
      proposals = result.proposals;
      fs.mkdirSync(path.dirname(values.out!), { recursive: true });
      fs.writeFileSync(values.out!, JSON.stringify(proposals, null, 2));
      console.log(
        `Got ${proposals.length} usable answers; ${result.unresolved.length} payees unresolved` +
          (result.deferred ? `, ${result.deferred} left for the next run (--max-calls)` : "") +
          `. Saved to ${values.out}.`,
      );
    }

    const eligible = proposals.filter((p) => CONFIDENCES.indexOf(p.confidence) >= CONFIDENCES.indexOf(minConfidence));
    for (const p of proposals.slice(0, 60)) {
      const mark = eligible.includes(p) ? "+" : "·";
      console.log(
        ` ${mark} ${p.payee.padEnd(32).slice(0, 32)} → ${p.categoryName.padEnd(18)} ${p.confidence.padEnd(6)} ${p.count}x`,
      );
    }
    if (proposals.length > 60) console.log(`   ... and ${proposals.length - 60} more in the file`);

    if (!values.apply) {
      console.log(
        `\nPreview only (+ would be written at --min-confidence ${minConfidence}: ${eligible.length} of ${proposals.length}).` +
          `\nRe-run with  --from ${values.from ?? values.out} --apply  to write them without paying again.`,
      );
      return;
    }
    const r = applyProposals(db, proposals, { minConfidence, makeRules: values["make-rules"] });
    console.log(
      `\nApplied: ${r.transactionsUpdated} transactions across ${r.groupsApplied} payees (${r.groupsSkipped} skipped), ${r.rulesCreated} rules created.`,
    );
  } finally {
    sqlite.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

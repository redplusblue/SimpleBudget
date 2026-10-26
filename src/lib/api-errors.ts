import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AiConfigError } from "@/lib/llm/config";
import { AssistantError } from "@/lib/ai/assistant";
import { MemoryError } from "@/lib/ai/memory";
import { ProposalError } from "@/lib/ai/proposals";
import { ModelListError } from "@/lib/llm/models";
import { LlmError } from "@/lib/llm/types";
import { ManualError } from "@/lib/finance/manual";
import { NotifyConfigError } from "@/lib/notify/config";
import { GoalError } from "@/lib/finance/goals";
import { ImportError } from "@/lib/import/plan";
import { ReconcileError } from "@/lib/finance/reconcile";
import { SplitError } from "@/lib/finance/splits";
import { TargetError } from "@/lib/finance/targets";
import { TaxonomyError } from "@/lib/finance/taxonomy-admin";
import { UpdateError } from "@/lib/finance/transactions-update";
import { RuleError } from "@/lib/rules/store";

const STATUS = { not_found: 404, invalid: 400, conflict: 409 } as const;

/** Maps the domain errors thrown by lib code to JSON responses; anything unexpected is rethrown. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: "invalid_request", message: e.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  if (e instanceof LlmError) {
    // The message is written to be shown to the user; the insights themselves keep working without AI.
    return NextResponse.json({ error: "ai_unavailable", kind: e.kind, message: e.message }, { status: 502 });
  }
  if (
    e instanceof NotifyConfigError ||
    e instanceof GoalError ||
    e instanceof ImportError ||
    e instanceof ReconcileError ||
    e instanceof ManualError ||
    e instanceof SplitError ||
    e instanceof AiConfigError ||
    e instanceof ModelListError ||
    e instanceof ProposalError ||
    e instanceof MemoryError ||
    e instanceof AssistantError ||
    e instanceof TaxonomyError ||
    e instanceof TargetError ||
    e instanceof RuleError ||
    e instanceof UpdateError
  ) {
    return NextResponse.json({ error: e.code, message: e.message }, { status: STATUS[e.code] });
  }
  throw e;
}

export const readJson = (request: Request) => request.json().catch(() => null);

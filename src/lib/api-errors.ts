import { NextResponse } from "next/server";
import { ZodError } from "zod";
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
  if (e instanceof TaxonomyError || e instanceof TargetError || e instanceof RuleError || e instanceof UpdateError) {
    return NextResponse.json({ error: e.code, message: e.message }, { status: STATUS[e.code] });
  }
  throw e;
}

export const readJson = (request: Request) => request.json().catch(() => null);

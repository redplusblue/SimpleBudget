import { getDb } from "@/db/client";
import { requireApiAuth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { EXPORT_FORMATS, EXPORT_TYPES, type ExportFormat } from "@/lib/export/transactions";
import { localDateString } from "@/lib/finance/dates";
import { parseFilterParams } from "@/lib/finance/transaction-params";

export const dynamic = "force-dynamic";

/** Transactions as a download. `?format=csv` (default) | `txt` | `tsv` | `json`, plus the same filters as GET /api/transactions (none = everything). */
export async function GET(request: Request) {
  const denied = await requireApiAuth();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const requested = (params.get("format") ?? "csv").toLowerCase();
  if (!EXPORT_FORMATS.includes(requested as ExportFormat)) {
    return Response.json({ error: `format must be one of ${EXPORT_FORMATS.join(", ")}` }, { status: 400 });
  }
  const parsed = parseFilterParams(params);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const format = requested as ExportFormat;
  const tz = getEnv().TZ;
  const type = EXPORT_TYPES[format];
  const body = type.build(getDb(), tz, parsed.filters);
  return new Response(type.bom ? `\uFEFF${body}` : body, {
    headers: {
      "content-type": `${type.mime}; charset=utf-8`,
      "content-disposition": `attachment; filename="simplebudget-transactions-${localDateString(Math.floor(Date.now() / 1000), tz)}.${format}"`,
      "cache-control": "no-store",
    },
  });
}

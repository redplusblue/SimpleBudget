"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useRefreshMoney } from "@/hooks/use-refresh-money";
import { ApiError, fetchJson, jsonBody } from "@/lib/fetch-json";
import { parseCsv } from "@/lib/export/csv";
import { accountLabels, guessMapping, mappingProblem, parseImportFile } from "@/lib/import/parse";
import {
  DATE_FORMATS,
  DATE_FORMAT_LABELS,
  MAX_IMPORT_CHARS,
  type AccountTarget,
  type ColumnMapping,
  type DateFormat,
  type ImportPreview,
  type ImportResult,
} from "@/lib/import/types";

const NONE = "none";
const SKIP = "skip";
const NEW = "new";

interface AccountRow {
  id: string;
  name: string;
  displayName: string | null;
  orgName: string;
}

type Field = Exclude<keyof ColumnMapping, "invertSigns">;
const FIELD_LABELS: Record<Field, string> = {
  date: "Date",
  amount: "Amount (one signed column)",
  debit: "Money out (debit)",
  credit: "Money in (credit)",
  payee: "Payee / description",
  notes: "Notes",
  category: "Category",
  account: "Account",
};
const OPTIONAL: Field[] = ["amount", "debit", "credit", "payee", "notes", "category", "account"];

const suggestAccount = (label: string, accounts: AccountRow[]): AccountTarget => {
  const key = label.trim().toLowerCase();
  const hit = accounts.find((a) => [a.displayName, a.name].some((n) => n && n.trim().toLowerCase() === key));
  return hit ? { type: "existing", accountId: hit.id } : { type: "new", name: label };
};

export function ImportWizard() {
  const refresh = useRefreshMoney();
  const accountsQuery = useQuery({
    queryKey: ["accounts-raw"],
    queryFn: async () => (await fetchJson<{ accounts: AccountRow[] }>("/api/accounts")).accounts,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [dateFormat, setDateFormat] = useState<DateFormat>("iso");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [targets, setTargets] = useState<Record<string, AccountTarget>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => (csv && mapping && !mappingProblem(mapping) ? parseImportFile(csv, hasHeader, dateFormat, mapping) : null),
    [csv, hasHeader, dateFormat, mapping],
  );
  const headers = useMemo(
    () => (csv ? parseImportFile(csv, hasHeader, dateFormat, mapping ?? guessMapping([]).mapping).headers : []),
    [csv, hasHeader, dateFormat, mapping],
  );
  const labels = useMemo(() => (parsed ? accountLabels(parsed.rows) : []), [parsed]);
  const resetOutcome = () => (setPreview(null), setResult(null), setError(null));

  async function onFile(file: File | undefined) {
    resetOutcome();
    if (!file) return;
    if (file.size > MAX_IMPORT_CHARS) return setError("That file is too large (10 MB at most).");
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    const guess = guessMapping(parseCsv(text)[0] ?? []);
    setMapping(guess.mapping);
    setHasHeader(true);
    setDateFormat("iso");
    setTargets({});
  }

  // Suggest a destination for every account name in the file until the user chooses one.
  const effectiveTargets = useMemo(
    () => Object.fromEntries(labels.map((l) => [l, targets[l] ?? suggestAccount(l, accounts)])),
    [labels, targets, accounts],
  );

  const body = () => ({ csv, hasHeader, dateFormat, mapping, accounts: effectiveTargets });
  const run = useMutation({
    mutationFn: async (kind: "preview" | "commit") => {
      if (kind === "preview")
        return {
          kind: "preview" as const,
          preview: (await fetchJson<{ preview: ImportPreview }>("/api/import/preview", jsonBody("POST", body())))
            .preview,
        };
      return {
        kind: "commit" as const,
        result: (await fetchJson<{ result: ImportResult }>("/api/import/commit", jsonBody("POST", body()))).result,
      };
    },
    onSuccess: (r) => {
      if (r.kind === "preview") setPreview(r.preview);
      else {
        setResult(r.result);
        setPreview(null);
        refresh();
      }
    },
    onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : "The import failed"),
  });

  const problem = mapping ? mappingProblem(mapping) : null;
  const setField = (field: Field, value: string) => {
    resetOutcome();
    setMapping((m) => (m ? { ...m, [field]: value === NONE ? null : Number(value) } : m));
  };
  const ready = !!csv && !!mapping && !problem && !!parsed && parsed.rows.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose a file</CardTitle>
          <CardDescription>
            Actual Budget&apos;s CSV transaction export works as is. Any other CSV from a bank or app works too: you
            tell SimpleBudget which column is which.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild variant="outline" className="h-11 md:h-9">
            <label className="cursor-pointer">
              <FileUp /> {fileName ?? "Choose a .csv file"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="CSV file"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
          </Button>
          {csv && parsed && (
            <p className="text-sm text-muted-foreground" data-testid="import-file-info">
              {parsed.dataRows.toLocaleString()} rows found
              {parsed.problems.length ? `, ${parsed.problems.length} that can't be read` : ""}.
            </p>
          )}
        </CardContent>
      </Card>

      {csv && mapping && (
        <Card>
          <CardHeader>
            <CardTitle>2. Match the columns</CardTitle>
            <CardDescription>We guessed from the column names. Change anything that&apos;s wrong.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
              <Label htmlFor="imp-header">First row is a header</Label>
              <Switch id="imp-header" checked={hasHeader} onCheckedChange={(v) => (resetOutcome(), setHasHeader(v))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColumnSelect
                label={FIELD_LABELS.date}
                value={mapping.date}
                headers={headers}
                required
                onChange={(v) => setField("date", v)}
              />
              {OPTIONAL.map((f) => (
                <ColumnSelect
                  key={f}
                  label={FIELD_LABELS[f]}
                  value={mapping[f]}
                  headers={headers}
                  onChange={(v) => setField(f, v)}
                />
              ))}
              <div className="space-y-2">
                <Label>Date format</Label>
                <Select value={dateFormat} onValueChange={(v) => (resetOutcome(), setDateFormat(v as DateFormat))}>
                  <SelectTrigger aria-label="Date format" className="h-11 w-full md:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_FORMATS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {DATE_FORMAT_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3">
              <div>
                <Label htmlFor="imp-invert">Charges are positive numbers</Label>
                <p className="text-xs text-muted-foreground">
                  Turn on for credit card statements that list purchases as positive amounts.
                </p>
              </div>
              <Switch
                id="imp-invert"
                checked={mapping.invertSigns}
                onCheckedChange={(v) => (resetOutcome(), setMapping({ ...mapping, invertSigns: v }))}
              />
            </div>
            {problem && (
              <p role="alert" className="text-sm text-negative">
                {problem}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {ready && labels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>3. Match the accounts</CardTitle>
            <CardDescription>
              Choose where each account in the file goes. Existing accounts are matched by name where possible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {labels.map((label) => {
              const t = effectiveTargets[label];
              const value = t.type === "existing" ? t.accountId : t.type === "new" ? NEW : SKIP;
              return (
                <div
                  key={label}
                  className="grid items-center gap-2 sm:grid-cols-[1fr_1fr]"
                  data-testid="import-account-row"
                >
                  <span className="truncate text-sm font-medium">{label}</span>
                  <Select
                    value={value}
                    onValueChange={(v) => {
                      resetOutcome();
                      setTargets((prev) => ({
                        ...prev,
                        [label]:
                          v === NEW
                            ? { type: "new", name: label }
                            : v === SKIP
                              ? { type: "skip" }
                              : { type: "existing", accountId: v },
                      }));
                    }}
                  >
                    <SelectTrigger aria-label={`Destination for ${label}`} className="h-11 w-full md:h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.displayName || a.name} · {a.orgName}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW}>Create a new manual account</SelectItem>
                      <SelectItem value={SKIP}>Skip these rows</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {ready && (
        <Card>
          <CardHeader>
            <CardTitle>4. Preview, then import</CardTitle>
            <CardDescription>Nothing is saved until you press Import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              className="h-11 md:h-9"
              disabled={run.isPending}
              onClick={() => (resetOutcome(), run.mutate("preview"))}
            >
              {run.isPending && run.variables === "preview" && <Loader2 className="animate-spin" />} Preview
            </Button>
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            {preview && <PreviewView preview={preview} />}
            {preview && (
              <Button
                className="h-11 md:h-9"
                disabled={run.isPending || preview.inserts + preview.matches === 0}
                onClick={() => run.mutate("commit")}
              >
                {run.isPending && run.variables === "commit" && <Loader2 className="animate-spin" />} Import{" "}
                {preview.inserts.toLocaleString()} new
                {preview.matches ? ` and update ${preview.matches.toLocaleString()}` : ""}
              </Button>
            )}
            {result && (
              <div
                role="status"
                data-testid="import-result"
                className="space-y-2 rounded-xl border border-border p-3 text-sm"
              >
                <p className="flex items-center gap-2 font-medium text-positive">
                  <CheckCircle2 className="size-4" aria-hidden /> Import finished
                </p>
                <p>
                  Added {result.inserted.toLocaleString()} transactions, filled in {result.updated.toLocaleString()}{" "}
                  existing ones
                  {result.categoriesCreated ? `, created ${result.categoriesCreated} categories` : ""}
                  {result.accountsCreated
                    ? ` and ${result.accountsCreated} account${result.accountsCreated === 1 ? "" : "s"}`
                    : ""}
                  .
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/transactions">View transactions</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {!ready && error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  headers,
  onChange,
  required,
}: {
  label: string;
  value: number | null;
  headers: string[];
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value === null ? NONE : String(value)} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-11 w-full md:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value={NONE}>None</SelectItem>}
          {headers.map((h, i) => (
            <SelectItem key={i} value={String(i)}>
              {h || `Column ${i + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PreviewView({ preview }: { preview: ImportPreview }) {
  return (
    <div className="space-y-3" data-testid="import-preview">
      <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="New" value={preview.inserts} />
        <Stat label="Matched" value={preview.matches} />
        <Stat label="Skipped" value={preview.skipped} />
        <Stat label="Unreadable" value={preview.problems.length} />
      </ul>
      {(preview.newCategories.length > 0 || preview.newAccounts.length > 0) && (
        <p className="text-sm text-muted-foreground">
          {preview.newCategories.length > 0 && <>Will create categories: {preview.newCategories.join(", ")}. </>}
          {preview.newAccounts.length > 0 && <>Will create accounts: {preview.newAccounts.join(", ")}.</>}
        </p>
      )}
      {preview.skipReasons.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {preview.skipReasons.map((r) => (
            <li key={r.reason}>
              {r.count.toLocaleString()} skipped: {r.reason}
            </li>
          ))}
        </ul>
      )}
      {preview.problems.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Rows that can&apos;t be read ({preview.problems.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {preview.problems.map((p, i) => (
              <li key={i}>
                Line {p.line}: {p.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-surface-2 text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">What happens</th>
              <th className="p-2 font-medium">Date</th>
              <th className="p-2 font-medium">Payee</th>
              <th className="p-2 font-medium">Category</th>
              <th className="p-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {preview.sample.map((r) => (
              <tr key={r.line} className="border-t border-border/60">
                <td className="p-2">
                  <Badge
                    variant="outline"
                    className={
                      r.action === "insert" ? "text-positive" : r.action === "skip" ? "text-muted-foreground" : ""
                    }
                  >
                    {r.action === "insert"
                      ? "Add"
                      : r.action === "match"
                        ? r.fills.length
                          ? `Fill ${r.fills.join(" + ")}`
                          : "Already here"
                        : "Skip"}
                  </Badge>
                </td>
                <td className="p-2 whitespace-nowrap">{r.date}</td>
                <td className="max-w-[160px] truncate p-2">{r.payee || "—"}</td>
                <td className="max-w-[120px] truncate p-2">{r.category || "—"}</td>
                <td className="p-2 text-right">
                  <Money cents={r.amountCents} colorize />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Showing a sample of each kind.</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-xl border border-border p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
    </li>
  );
}

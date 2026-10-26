"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FIELD_LABELS, MAX_CONDITIONS, OPS_FOR_FIELD, OP_LABELS, type ConditionField } from "@/lib/rules/types";
import { changeField, newCondition, type ConditionDraft } from "./draft";

const FIELDS = Object.keys(FIELD_LABELS) as ConditionField[];

/** The "If all/any of these match" editor, shared by the rule builder and automations. */
export function ConditionEditor({
  match,
  conditions,
  accounts,
  onChange,
}: {
  match: "all" | "any";
  conditions: ConditionDraft[];
  accounts: Array<{ id: string; label: string }>;
  onChange: (patch: { match?: "all" | "any"; conditions?: ConditionDraft[] }) => void;
}) {
  const setCondition = (key: string, fn: (c: ConditionDraft) => ConditionDraft) =>
    onChange({ conditions: conditions.map((c) => (c.key === key ? fn(c) : c)) });

  return (
    <section aria-label="Conditions" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        If
        <Select value={match} onValueChange={(v) => onChange({ match: v as "all" | "any" })}>
          <SelectTrigger aria-label="Match mode" className="h-9 w-auto min-w-24 gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            <SelectItem value="any">any</SelectItem>
          </SelectContent>
        </Select>
        of these match:
      </div>

      <ul className="space-y-2">
        {conditions.map((c, i) => (
          <li
            key={c.key}
            data-testid="condition-row"
            className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-xl border border-border p-2 md:grid-cols-[130px_150px_minmax(0,1fr)_auto]"
          >
            <Select
              value={c.field}
              onValueChange={(v) => setCondition(c.key, (x) => changeField(x, v as ConditionField))}
            >
              <SelectTrigger aria-label={`Condition ${i + 1} field`} className="h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FIELD_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={c.op}
              onValueChange={(v) => setCondition(c.key, (x) => ({ ...x, op: v }))}
              disabled={OPS_FOR_FIELD[c.field].length === 1}
            >
              <SelectTrigger aria-label={`Condition ${i + 1} operator`} className="h-11 w-full md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS_FOR_FIELD[c.field].map((op) => (
                  <SelectItem key={op} value={op}>
                    {OP_LABELS[op]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="order-3 size-11 md:order-4 md:size-9"
              aria-label={`Remove condition ${i + 1}`}
              disabled={conditions.length === 1}
              onClick={() => onChange({ conditions: conditions.filter((x) => x.key !== c.key) })}
            >
              <Trash2 className="size-4" />
            </Button>
            <div className="order-4 col-span-3 md:order-3 md:col-span-1">
              <ValueInput c={c} index={i} accounts={accounts} onChange={(fn) => setCondition(c.key, fn)} />
            </div>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={conditions.length >= MAX_CONDITIONS}
        onClick={() => onChange({ conditions: [...conditions, newCondition()] })}
      >
        <Plus /> Add condition
      </Button>
    </section>
  );
}

function ValueInput({
  c,
  index,
  accounts,
  onChange,
}: {
  c: ConditionDraft;
  index: number;
  accounts: Array<{ id: string; label: string }>;
  onChange: (fn: (c: ConditionDraft) => ConditionDraft) => void;
}) {
  const label = `Condition ${index + 1} value`;
  if (c.field === "direction") {
    return (
      <Select value={c.text || "expense"} onValueChange={(v) => onChange((x) => ({ ...x, text: v }))}>
        <SelectTrigger aria-label={label} className="h-11 w-full md:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="expense">Money goes out (expense)</SelectItem>
          <SelectItem value="income">Money comes in (income)</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (c.field === "account") {
    return (
      <Select value={c.text} onValueChange={(v) => onChange((x) => ({ ...x, text: v }))}>
        <SelectTrigger aria-label={label} className="h-11 w-full md:h-9">
          <SelectValue placeholder="Choose an account" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (c.field === "amount" && c.op === "between") {
    return (
      <div className="flex items-center gap-2">
        <Input
          aria-label={`${label}: minimum`}
          inputMode="decimal"
          placeholder="Min $"
          value={c.min}
          onChange={(e) => onChange((x) => ({ ...x, min: e.target.value }))}
          className="h-11 md:h-9"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          aria-label={`${label}: maximum`}
          inputMode="decimal"
          placeholder="Max $"
          value={c.max}
          onChange={(e) => onChange((x) => ({ ...x, max: e.target.value }))}
          className="h-11 md:h-9"
        />
      </div>
    );
  }
  const isAmount = c.field === "amount";
  return (
    <Input
      aria-label={label}
      inputMode={isAmount ? "decimal" : "text"}
      placeholder={
        isAmount
          ? "Amount in $"
          : c.op === "regex"
            ? "Regular expression"
            : c.field === "payee"
              ? "e.g. trader joe"
              : "Text to look for"
      }
      value={c.text}
      maxLength={300}
      onChange={(e) => onChange((x) => ({ ...x, text: e.target.value }))}
      className="h-11 md:h-9"
    />
  );
}

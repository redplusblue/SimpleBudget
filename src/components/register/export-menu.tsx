"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { filtersToSearchParams } from "@/lib/finance/transaction-params";
import type { TransactionFilters } from "@/lib/finance/transaction-types";

const FORMATS = [
  ["txt", "Text (.txt)"],
  ["csv", "CSV (.csv)"],
  ["tsv", "TSV (.tsv)"],
  ["json", "JSON (.json)"],
] as const;

/** Downloads exactly what the current filters show (not just the loaded page). */
export function ExportMenu({ filters }: { filters: TransactionFilters }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="size-11 shrink-0 md:size-9" aria-label="Export transactions">
          <Download />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FORMATS.map(([format, label]) => {
          const params = filtersToSearchParams(filters);
          params.set("format", format);
          return (
            <DropdownMenuItem key={format} asChild>
              <a href={`/api/export/transactions?${params}`} download>
                {label}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

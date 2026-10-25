"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GO_SHORTCUTS } from "@/lib/keyboard";

const HELP: Array<[string, string]> = [
  ["⌘K / Ctrl K", "Open the command menu"],
  ...GO_SHORTCUTS.map(({ key, label }): [string, string] => [`g then ${key}`, `Go to ${label}`]),
  ["/", "Search transactions"],
  ["j / k", "Move down / up in the register"],
  ["Enter", "Open the highlighted transaction"],
  ["c", "Set the highlighted transaction's category"],
  ["Esc", "Clear the highlight or close a panel"],
  ["?", "Show this list"],
];

export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys work when you aren&apos;t typing in a field.</DialogDescription>
        </DialogHeader>
        <dl className="divide-y divide-border/60 text-sm">
          {HELP.map(([keys, what]) => (
            <div key={keys} className="flex items-center justify-between gap-4 py-1.5">
              <dt className="text-muted-foreground">{what}</dt>
              <dd>
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs">{keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

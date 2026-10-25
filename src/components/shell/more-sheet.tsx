"use client";

import Link from "next/link";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MORE_ITEMS } from "./nav";

export function MoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="pb-safe rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>More</SheetTitle>
          <SheetDescription className="sr-only">Additional pages</SheetDescription>
        </SheetHeader>
        <div className="grid gap-1 px-4 pb-4">
          {MORE_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => onOpenChange(false)}
              className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-surface-2"
            >
              <Icon className="size-5 text-muted-foreground" />
              {label}
            </Link>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

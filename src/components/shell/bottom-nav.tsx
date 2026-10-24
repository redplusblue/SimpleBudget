"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { isActive, MOBILE_TABS, MORE_ITEMS } from "./nav";

const tabClass =
  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors";

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_ITEMS.some((i) => isActive(pathname, i.href));

  return (
    <>
      <nav
        aria-label="Primary"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur lg:hidden"
      >
        {MOBILE_TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(tabClass, active && "text-primary")}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(tabClass, moreActive && "text-primary")}
          aria-haspopup="dialog"
        >
          <Ellipsis className="size-5" />
          More
        </button>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
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
                onClick={() => setMoreOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-surface-2"
              >
                <Icon className="size-5 text-muted-foreground" />
                {label}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

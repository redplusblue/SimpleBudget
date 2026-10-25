"use client";

import { Ellipsis } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { isActive, MOBILE_TABS, MORE_ITEMS } from "./nav";

const MoreSheet = dynamic(() => import("./more-sheet").then((m) => m.MoreSheet), { ssr: false });

const tabClass =
  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors";

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // The sheet's code (dialog machinery) only downloads the first time "More" is tapped.
  const [moreEver, setMoreEver] = useState(false);
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
              className={cn(tabClass, active && "text-link")}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => (setMoreEver(true), setMoreOpen(true))}
          className={cn(tabClass, moreActive && "text-link")}
          aria-haspopup="dialog"
        >
          <Ellipsis className="size-5" />
          More
        </button>
      </nav>
      {moreEver && <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} />}
    </>
  );
}

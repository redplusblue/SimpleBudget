"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/categories", label: "Categories" },
  { href: "/settings/tags", label: "Tags" },
  { href: "/settings/sync", label: "Sync" },
  { href: "/settings/account", label: "Account" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
      {ITEMS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground md:min-h-9",
              active && "bg-surface-2 text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

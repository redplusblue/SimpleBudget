"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import type { TargetRow } from "@/lib/finance/targets-types";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/categories", label: "Categories" },
  { href: "/settings/tags", label: "Tags" },
  { href: "/settings/sync", label: "Sync" },
  { href: "/settings/account", label: "Account" },
];

const TARGETS_TAB = { href: "/settings/targets", label: "Targets" };

export function SettingsNav() {
  const pathname = usePathname();
  // Targets are optional, so their tab only appears once you have one (or while you're on that page). The first one
  // is added from a category or tag's menu.
  const { data: targets } = useQuery({
    queryKey: ["targets"],
    queryFn: async () => (await fetchJson<{ targets: TargetRow[] }>("/api/targets")).targets,
    staleTime: 30_000,
  });
  const items = [
    ...ITEMS.slice(0, 3),
    ...(targets?.length || pathname.startsWith(TARGETS_TAB.href) ? [TARGETS_TAB] : []),
    ...ITEMS.slice(3),
  ];
  return (
    <nav aria-label="Settings" className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
      {items.map(({ href, label }) => {
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

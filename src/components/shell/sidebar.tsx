"use client";

import { PanelLeftClose, PanelLeftOpen, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS } from "./nav";
import { SidebarAccounts } from "./sidebar-accounts";

const STORAGE_KEY = "sb:sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
  }, []);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  }

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <span className="bg-brand-gradient grid size-8 shrink-0 place-items-center rounded-lg text-white">
          <Wallet className="size-4" />
        </span>
        {!collapsed && <span className="text-[15px] font-semibold tracking-tight">SimpleBudget</span>}
      </div>
      <nav aria-label="Primary" className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Fragment key={href}>
              <Link
                href={href}
                title={collapsed ? label : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
                  active && "bg-surface-2 text-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon className={cn("size-[18px] shrink-0", active && "text-link")} />
                {!collapsed && label}
                {collapsed && <span className="sr-only">{label}</span>}
              </Link>
              {href === "/accounts" && !collapsed && <SidebarAccounts />}
            </Fragment>
          );
        })}
      </nav>
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}

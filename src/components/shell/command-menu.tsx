"use client";

import { Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const CommandPalette = dynamic(() => import("./command-palette").then((m) => m.CommandPalette), { ssr: false });

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  // The palette (cmdk + dialog) only downloads the first time it is opened.
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setEverOpened(true);
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => (setEverOpened(true), setOpen(true))}
        aria-label="Search"
        className="h-11 justify-start gap-2 bg-surface text-muted-foreground md:h-9 md:w-64"
      >
        <Search className="size-4" />
        <span className="hidden md:inline">Search…</span>
        <kbd className="ml-auto hidden rounded border border-border px-1.5 text-[10px] md:inline">⌘K</kbd>
      </Button>
      {everOpened && <CommandPalette open={open} onOpenChange={setOpen} />}
    </>
  );
}

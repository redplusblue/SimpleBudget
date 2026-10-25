"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GO_SHORTCUTS, isTypingTarget, modalOpen } from "@/lib/keyboard";

const SEQUENCE_MS = 1000;

// The help dialog's code (dialog machinery) only downloads the first time "?" is pressed.
const ShortcutsHelp = dynamic(() => import("./shortcuts-help").then((m) => m.ShortcutsHelp), { ssr: false });

/** Desktop keyboard shortcuts that work on every page (the register adds j/k/Enter/c itself). */
export function Shortcuts() {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const [helpEver, setHelpEver] = useState(false);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingTarget(e) || modalOpen()) return;
      const now = Date.now();
      if (pendingG.current && now - pendingG.current < SEQUENCE_MS) {
        pendingG.current = null;
        const go = GO_SHORTCUTS.find((s) => s.key === e.key.toLowerCase());
        if (go) {
          e.preventDefault();
          router.push(go.href);
        }
        return;
      }
      if (e.key === "g") {
        pendingG.current = now;
      } else if (e.key === "/") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>("[data-search-input]");
        if (input) input.focus();
        else router.push("/transactions#search");
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpEver(true);
        setHelp(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return helpEver ? <ShortcutsHelp open={help} onOpenChange={setHelp} /> : null;
}

"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PRIVACY_KEY } from "@/lib/privacy";

function read(): boolean {
  return document.documentElement.dataset.privacy === "on";
}

/** Eye button in the top bar: blurs every money value (`[data-money]`) until switched off. Remembered per browser. */
export function PrivacyToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(read()), []);

  function toggle() {
    const next = !read();
    if (next) document.documentElement.dataset.privacy = "on";
    else delete document.documentElement.dataset.privacy;
    try {
      if (next) localStorage.setItem(PRIVACY_KEY, "on");
      else localStorage.removeItem(PRIVACY_KEY);
    } catch {
      // Private browsing: it still works for this page view.
    }
    setOn(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 md:size-9"
      aria-pressed={on}
      aria-label={on ? "Show amounts" : "Hide amounts"}
      title={on ? "Show amounts" : "Hide amounts"}
      onClick={toggle}
    >
      {on ? <EyeOff /> : <Eye />}
    </Button>
  );
}

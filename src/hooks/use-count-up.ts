"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number toward `target` over `durationMs` (ease-out). The first render counts up from zero,
 * later changes animate from the value currently on screen. Skips the animation entirely when the user
 * prefers reduced motion.
 */
export function useCountUp(target: number, durationMs = 300): number {
  const [value, setValue] = useState(0);
  const shown = useRef(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || durationMs <= 0) {
      shown.current = target;
      setValue(target);
      return;
    }
    const from = shown.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      shown.current = from + (target - from) * eased;
      setValue(shown.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return Math.round(value);
}

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number toward `target` over `durationMs` (ease-out). The first render shows `target` as is (so
 * server-rendered HTML has the real number); later changes animate from the value currently on screen. Skips the animation entirely when the user
 * prefers reduced motion.
 */
export function useCountUp(target: number, durationMs = 300): number {
  // Starts at the target, so the first paint (and server-rendered HTML) already shows the real number; later changes animate.
  const [value, setValue] = useState(target);
  const shown = useRef(target);

  useEffect(() => {
    if (shown.current === target) return;
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

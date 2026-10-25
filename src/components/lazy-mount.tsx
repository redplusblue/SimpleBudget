"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders `children` only once the placeholder is near the viewport. Heavy cards (charts) further down the page then
 * cost nothing on first load, which keeps hydration and the main thread quick; they mount as you scroll.
 * `minHeight` reserves the space so nothing jumps.
 */
export function LazyMount({
  children,
  minHeight,
  rootMargin = "100px",
  className,
}: {
  children: React.ReactNode;
  minHeight: number;
  rootMargin?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (typeof IntersectionObserver === "undefined") return setShown(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);

  return (
    <div
      ref={ref}
      className={className}
      data-lazy={shown ? "ready" : "pending"}
      style={shown ? undefined : { minHeight }}
    >
      {shown ? children : null}
    </div>
  );
}

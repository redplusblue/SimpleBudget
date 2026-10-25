"use client";

import { useEffect } from "react";

/** Registers the static-asset service worker in production builds (it is what makes the app installable). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not installable over plain HTTP on a non-localhost address; the app works fine without it.
    });
  }, []);
  return null;
}

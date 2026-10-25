import { z } from "zod";

// Zod's fast path compiles validators with `new Function`, which a strict Content-Security-Policy (no 'unsafe-eval')
// forbids; it probes for that and the browser logs a violation. In the browser we switch the fast path off, so the
// probe never happens. (Validation is a handful of small forms there, so speed is irrelevant.)
if (typeof window !== "undefined") z.config({ jitless: true });

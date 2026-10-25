export interface DraftPart {
  categoryId: number | null;
  /** Positive dollars as typed. */
  amount: string;
  notes: string;
}

/**
 * How much of `totalCents` (positive) the drafted parts leave unassigned. `valid` means at least two parts, every
 * amount parses to more than zero, and nothing is left over or short.
 */
export function splitRemaining(parts: DraftPart[], totalCents: number, parse: (s: string) => number) {
  const centsList = parts.map((p) => {
    const text = p.amount.trim().replace(/^\$/, "");
    if (!text) return 0;
    try {
      return Math.max(0, Math.abs(parse(text)));
    } catch {
      return NaN;
    }
  });
  const anyBad = centsList.some((c) => Number.isNaN(c));
  const sum = centsList.reduce((s, c) => s + (Number.isNaN(c) ? 0 : c), 0);
  const remainingCents = totalCents - sum;
  return {
    centsList: centsList.map((c) => (Number.isNaN(c) ? 0 : c)),
    remainingCents,
    valid: !anyBad && parts.length >= 2 && centsList.every((c) => c > 0) && remainingCents === 0,
  };
}

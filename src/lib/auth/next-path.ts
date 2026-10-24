/** Only same-origin relative paths are allowed as post-login redirects (prevents open redirects). */
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (/[\u0000-\u001f]/.test(next)) return "/";
  return next;
}

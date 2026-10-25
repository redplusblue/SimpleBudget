/** True when the key press is going into a text field (or a menu), so single-key shortcuts must stay out of the way. */
export function isTypingTarget(e: Pick<KeyboardEvent, "target">): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.isContentEditable) return true;
  return !!el.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu']",
  );
}

/** A modal (dialog, sheet, command palette) is open, so page-level shortcuts are paused. */
export function modalOpen(): boolean {
  return typeof document !== "undefined" && !!document.querySelector("[role='dialog'], [role='alertdialog']");
}

export const GO_SHORTCUTS: Array<{ key: string; href: string; label: string }> = [
  { key: "d", href: "/", label: "Dashboard" },
  { key: "t", href: "/transactions", label: "Transactions" },
  { key: "a", href: "/accounts", label: "Accounts" },
  { key: "s", href: "/spending", label: "Spending" },
  { key: "i", href: "/insights", label: "Insights" },
  { key: "r", href: "/rules", label: "Rules" },
];

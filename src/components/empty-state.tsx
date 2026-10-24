import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <p className="max-w-xs text-sm text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}

import { CalendarClock, Lightbulb } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

function Placeholder({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: typeof Lightbulb;
  children: string;
}) {
  return (
    <Card aria-labelledby={id}>
      <CardContent className="space-y-3">
        <h2 id={id} className="text-sm font-medium text-muted-foreground">
          {title}
        </h2>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2">
            <Icon className="size-4" aria-hidden />
          </span>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

/** Filled in once recurring charges are detected (Phase 7). */
export const UpcomingCard = () => (
  <Placeholder id="upcoming-title" title="Upcoming" icon={CalendarClock}>
    Recurring bills and subscriptions will appear here once they&apos;re detected.
  </Placeholder>
);

/** Filled in once insights exist (Phase 9). */
export const InsightsTeaser = () => (
  <Placeholder id="insights-title" title="Insights" icon={Lightbulb}>
    Highlights about your spending will show up here.
  </Placeholder>
);

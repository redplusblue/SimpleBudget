import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 text-center">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">That page doesn&apos;t exist.</p>
        <Button asChild className="h-11 md:h-9">
          <Link href="/">Back to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

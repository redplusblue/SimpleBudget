"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** A page-level crash keeps the sidebar and top bar and offers a retry. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
      <AlertTriangle className="size-8 text-warning" aria-hidden />
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This page hit an unexpected error. Your data is safe. Try again, or open another page.
      </p>
      <Button onClick={reset} className="h-11 md:h-9">
        Try again
      </Button>
    </div>
  );
}

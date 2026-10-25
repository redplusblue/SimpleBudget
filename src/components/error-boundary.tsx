"use client";

import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  /** What the section is called, for the message ("Net worth"). */
  name: string;
  children: ReactNode;
}

/** One failing card shows its own small error with a retry; the rest of the page keeps working. */
export class CardBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Visible in the browser console for debugging; nothing sensitive is in a render error.
    console.error(`[${this.props.name}] failed to render`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm"
        data-testid="card-error"
      >
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
        <span className="min-w-0 flex-1">{this.props.name} couldn&apos;t be shown.</span>
        <Button variant="outline" size="sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </Button>
      </div>
    );
  }
}

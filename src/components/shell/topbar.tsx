import { CommandMenu } from "./command-menu";
import { ThemeToggle } from "./theme-toggle";

export function Topbar() {
  return (
    <header className="pt-safe sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4 md:px-6">
        <CommandMenu />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

import { BottomNav } from "./bottom-nav";
import { Shortcuts } from "./shortcuts";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-6 md:pt-6 lg:pb-8">
          {children}
        </main>
      </div>
      <BottomNav />
      <Shortcuts />
    </div>
  );
}

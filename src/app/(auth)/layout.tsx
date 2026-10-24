import { Wallet } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-safe pb-safe flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-2.5">
        <span className="bg-brand-gradient grid size-9 place-items-center rounded-xl text-white">
          <Wallet className="size-5" />
        </span>
        <span className="text-lg font-semibold tracking-tight">SimpleBudget</span>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

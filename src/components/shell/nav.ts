import {
  CalendarRange,
  CreditCard,
  Flag,
  Lightbulb,
  Sparkles,
  PieChart,
  ReceiptText,
  Settings,
  SlidersHorizontal,
  LayoutDashboard,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/spending", label: "Spending", icon: PieChart },
  { href: "/accounts", label: "Accounts", icon: CreditCard },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/assistant", label: "Assistant", icon: Sparkles },
  { href: "/forecast", label: "Forecast", icon: TrendingUp },
  { href: "/goals", label: "Goals", icon: Flag },
  { href: "/year", label: "Year in review", icon: CalendarRange },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Bottom tab bar on mobile; the rest live under "More". */
export const MOBILE_TABS: NavItem[] = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/spending", label: "Spending", icon: PieChart },
  { href: "/accounts", label: "Accounts", icon: CreditCard },
  { href: "/transactions", label: "Activity", icon: ReceiptText },
];

export const MORE_ITEMS: NavItem[] = NAV_ITEMS.filter((i) =>
  ["/assistant", "/insights", "/forecast", "/goals", "/year", "/rules", "/settings"].includes(i.href),
);

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

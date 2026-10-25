import {
  ArrowLeftRight,
  Baby,
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  CircleDollarSign,
  Clapperboard,
  Coffee,
  Dumbbell,
  Ellipsis,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Hotel,
  House,
  Landmark,
  Music,
  PawPrint,
  Pill,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sprout,
  Star,
  Tag,
  Tv,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_ICON_NAMES, type CategoryIconName } from "@/lib/finance/category-icons";
import { cn } from "@/lib/utils";

// Imported by name (not the whole lucide set) to keep the bundle small.
export const CATEGORY_ICONS: Record<CategoryIconName, LucideIcon> = {
  "shopping-basket": ShoppingBasket,
  utensils: Utensils,
  coffee: Coffee,
  car: Car,
  bus: Bus,
  fuel: Fuel,
  "shopping-bag": ShoppingBag,
  shirt: Shirt,
  receipt: Receipt,
  zap: Zap,
  wifi: Wifi,
  smartphone: Smartphone,
  house: House,
  wrench: Wrench,
  repeat: Repeat,
  tv: Tv,
  "heart-pulse": HeartPulse,
  pill: Pill,
  dumbbell: Dumbbell,
  plane: Plane,
  hotel: Hotel,
  clapperboard: Clapperboard,
  music: Music,
  "gamepad-2": Gamepad2,
  banknote: Banknote,
  "piggy-bank": PiggyBank,
  briefcase: Briefcase,
  "arrow-left-right": ArrowLeftRight,
  landmark: Landmark,
  gift: Gift,
  baby: Baby,
  "paw-print": PawPrint,
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  scissors: Scissors,
  sprout: Sprout,
  ellipsis: Ellipsis,
  tag: Tag,
  star: Star,
  "circle-dollar-sign": CircleDollarSign,
};

export function isCategoryIcon(name: string | null | undefined): name is CategoryIconName {
  return !!name && (CATEGORY_ICON_NAMES as readonly string[]).includes(name);
}

/** A category's icon on a tinted circle in its color. Falls back to a tag icon. */
export function CategoryBadge({
  icon,
  color,
  className,
}: {
  icon: string | null | undefined;
  color: string;
  className?: string;
}) {
  const Icon = isCategoryIcon(icon) ? CATEGORY_ICONS[icon] : Tag;
  return (
    <span
      aria-hidden
      className={cn("grid size-9 shrink-0 place-items-center rounded-full", className)}
      style={{ background: `${color}26`, color }}
    >
      <Icon className="size-4" />
    </span>
  );
}

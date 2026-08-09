import type { MessageKey } from "@/lib/i18n/translate";
import {
  ShoppingCart,
  UtensilsCrossed,
  Coffee,
  Car,
  Home,
  Zap,
  Tv,
  ShoppingBag,
  Heart,
  CreditCard,
  Banknote,
  ArrowLeftRight,
  MoreHorizontal,
  Plane,
  Fuel,
  Bus,
  Bike,
  Train,
  Footprints,
  Lightbulb,
  Wrench,
  Smartphone,
  Laptop,
  Package,
  Plug,
  Landmark,
  TrendingUp,
  Briefcase,
  Receipt,
  Wallet,
  PiggyBank,
  Pill,
  Hospital,
  Dumbbell,
  Clapperboard,
  Gamepad2,
  Music,
  BookOpen,
  Palette,
  Shirt,
  Gift,
  Scissors,
  Sparkles,
  Tag,
  Paperclip,
  FolderOpen,
  CircleDollarSign,
  HandCoins,
  Baby,
  PawPrint,
  GraduationCap,
  Utensils,
  Wine,
  Beer,
  Globe,
  Leaf,
  type LucideIcon,
} from "lucide-react";

export const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  ShoppingCart,
  UtensilsCrossed,
  Coffee,
  Car,
  Home,
  Zap,
  Tv,
  ShoppingBag,
  Heart,
  CreditCard,
  Banknote,
  ArrowLeftRight,
  MoreHorizontal,
  Plane,
  Fuel,
  Bus,
  Bike,
  Train,
  Footprints,
  Lightbulb,
  Wrench,
  Smartphone,
  Laptop,
  Package,
  Plug,
  Landmark,
  TrendingUp,
  Briefcase,
  Receipt,
  Wallet,
  PiggyBank,
  Pill,
  Hospital,
  Dumbbell,
  Clapperboard,
  Gamepad2,
  Music,
  BookOpen,
  Palette,
  Shirt,
  Gift,
  Scissors,
  Sparkles,
  Tag,
  Paperclip,
  FolderOpen,
  CircleDollarSign,
  HandCoins,
  Baby,
  PawPrint,
  GraduationCap,
  Utensils,
  Wine,
  Beer,
  Globe,
  Leaf,
};

export const LUCIDE_ICON_SECTIONS: { labelKey: MessageKey; icons: string[] }[] = [
  {
    labelKey: "iconPicker.foodDrink",
    icons: ["ShoppingCart", "UtensilsCrossed", "Coffee", "Utensils", "Wine", "Beer"],
  },
  {
    labelKey: "iconPicker.transport",
    icons: ["Car", "Bus", "Bike", "Train", "Plane", "Fuel", "Footprints"],
  },
  {
    labelKey: "iconPicker.homeUtilities",
    icons: ["Home", "Lightbulb", "Wrench", "Smartphone", "Laptop", "Package", "Plug", "Zap"],
  },
  {
    labelKey: "iconPicker.moneyWork",
    icons: ["Banknote", "CreditCard", "Landmark", "Wallet", "PiggyBank", "CircleDollarSign", "HandCoins", "TrendingUp", "Briefcase", "Receipt"],
  },
  {
    labelKey: "iconPicker.healthPersonal",
    icons: ["Heart", "Pill", "Hospital", "Dumbbell", "Baby", "PawPrint", "GraduationCap"],
  },
  {
    labelKey: "iconPicker.entertainmentShopping",
    icons: ["Tv", "Clapperboard", "Gamepad2", "Music", "BookOpen", "Palette", "ShoppingBag", "Shirt", "Gift", "Scissors"],
  },
  {
    labelKey: "iconPicker.other",
    icons: ["Sparkles", "Tag", "Paperclip", "FolderOpen", "ArrowLeftRight", "Globe", "Leaf", "MoreHorizontal"],
  },
];

export function isEmoji(icon: string): boolean {
  return icon.codePointAt(0)! > 255;
}

interface CategoryIconProps {
  icon: string | null;
  color: string | null;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "w-6 h-6",
  md: "w-9 h-9",
  lg: "w-12 h-12",
};

const emojiSizes = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
};

const lucideSizes = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-6 w-6",
};

const dotSizes = {
  sm: "w-2 h-2",
  md: "w-3 h-3",
  lg: "w-4 h-4",
};

export function CategoryIcon({ icon, color, size = "md" }: CategoryIconProps) {
  const LucideComp = icon && !isEmoji(icon) ? LUCIDE_ICON_MAP[icon] : null;
  const emoji = icon && isEmoji(icon) ? icon : null;

  return (
    <div
      className={`${sizeClasses[size]} rounded-full flex items-center justify-center shrink-0`}
      style={{
        backgroundColor: color ? `${color}20` : undefined,
      }}
    >
      {emoji ? (
        <span className={`${emojiSizes[size]} leading-none`}>{emoji}</span>
      ) : LucideComp ? (
        <LucideComp
          className={lucideSizes[size]}
          style={{ color: color || undefined }}
        />
      ) : (
        <div
          className={`${dotSizes[size]} rounded-full`}
          style={{ backgroundColor: color || undefined }}
        />
      )}
    </div>
  );
}

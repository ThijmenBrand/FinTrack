"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Landmark, Tags, Sparkles, RefreshCcw } from "lucide-react";

const tabs = [
  { name: "Accounts", href: "/settings/accounts", icon: Landmark },
  { name: "Categories", href: "/settings/categories", icon: Tags },
  { name: "Automation", href: "/settings/automation", icon: Sparkles },
  { name: "Recurring", href: "/settings/recurring", icon: RefreshCcw },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your accounts, categories, and automation preferences.
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}

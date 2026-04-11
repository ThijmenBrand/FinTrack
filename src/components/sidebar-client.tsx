"use client";

import dynamic from "next/dynamic";

const Sidebar = dynamic(
  () => import("@/components/sidebar").then((m) => ({ default: m.Sidebar })),
  { ssr: false }
);

export function SidebarClient() {
  return <Sidebar />;
}

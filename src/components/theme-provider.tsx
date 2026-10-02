"use client";

import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

/** `--background` of each theme in hex — meta theme-color takes no oklch. */
const THEME_BACKGROUND: Record<string, string> = {
  light: "#f9fcff",
  dark: "#03080f",
  pink: "#fff0f7",
};

/**
 * Keeps the browser/status-bar colour on the page background. The viewport
 * metadata only knows the OS scheme; a user who picked dark (or pink) in the
 * app would otherwise get a light bar over a dark page.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const color = resolvedTheme && THEME_BACKGROUND[resolvedTheme];
    if (!color) return;
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", color));
  }, [resolvedTheme]);
  return null;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark", "pink"]}
    >
      <ThemeColorSync />
      {children}
    </NextThemesProvider>
  );
}

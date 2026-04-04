import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { DbInitializer } from "@/components/db-initializer";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Finance Tracker",
  description: "Personal finance tracking with smart categorization and budgeting",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <DbInitializer />
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-y-auto bg-background">
              <div className="mx-auto max-w-7xl p-6 lg:p-8">
                {children}
              </div>
            </main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}

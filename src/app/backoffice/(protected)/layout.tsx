import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireBackofficeAdmin } from "@/lib/auth";
import { BackofficeSignOut } from "./_components/sign-out-button";

export default async function BackofficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireBackofficeAdmin();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/backoffice" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold tracking-tight text-foreground">
                FinTrack Backoffice
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/backoffice"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Users
              </Link>
              <Link
                href="/backoffice/audit-logs"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Audit Logs
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {session.displayUsername}
            </span>
            <BackofficeSignOut />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
    </div>
  );
}

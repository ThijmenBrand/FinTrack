export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Every auth page renders inside AuthShell, which owns its own full-height
  // layout — this wrapper only sets the page background.
  return <div className="bg-background">{children}</div>;
}

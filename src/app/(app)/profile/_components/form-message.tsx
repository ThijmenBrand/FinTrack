import { cn } from "@/lib/utils";

export type FormMessageState = { type: "success" | "error"; text: string } | null;

export function FormMessage({
  message,
  className,
}: {
  message: FormMessageState;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      className={cn(
        "text-sm",
        message.type === "error" ? "text-destructive" : "text-green-600 dark:text-green-400",
        className
      )}
    >
      {message.text}
    </p>
  );
}

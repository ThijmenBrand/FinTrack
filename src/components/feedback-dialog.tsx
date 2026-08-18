"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2, MessageSquarePlus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { MAX_FEEDBACK_LENGTH } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Sidebar entry point: reads as an input so it invites typing, but a modal is
 * the right home — feedback is a written thought, not a one-line field, and it
 * must not lose the page the user was on.
 */
export function FeedbackButton({ collapsed }: { collapsed?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Bumping the key remounts the dialog, so every open starts on a blank sheet.
  const [session, setSession] = useState(0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
        title={collapsed ? t("feedback.trigger") : undefined}
        aria-label={collapsed ? t("feedback.trigger") : undefined}
        className={cn(
          "flex h-9 items-center rounded-lg border border-input bg-background/60 text-sm text-muted-foreground transition-colors",
          "hover:border-ring/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          collapsed ? "w-9 justify-center" : "w-full gap-2 px-3"
        )}
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{t("feedback.trigger")}</span>}
      </button>
      <FeedbackDialog key={session} open={open} onOpenChange={setOpen} />
    </>
  );
}

function FeedbackDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The mobile drawer animates in, so autoFocus alone can miss.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  // Close on its own once the thanks has been read.
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => onOpenChange(false), 1400);
    return () => clearTimeout(id);
  }, [sent, onOpenChange]);

  const send = async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, page: pathname }),
      });
      setSent(true);
    } catch (err) {
      console.error("Failed to send feedback:", err);
      setError(t("feedback.error"));
    } finally {
      setSending(false);
    }
  };

  const remaining = MAX_FEEDBACK_LENGTH - message.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Check className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-base">
                {t("feedback.sentTitle")}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {t("feedback.sentBody")}
              </DialogDescription>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("feedback.title")}</DialogTitle>
              <DialogDescription>
                {t("feedback.description")}
              </DialogDescription>
            </DialogHeader>

            <Textarea
              ref={inputRef}
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              maxLength={MAX_FEEDBACK_LENGTH}
              placeholder={t("feedback.placeholder")}
              className="min-h-32 resize-none"
            />

            <div className="flex min-h-5 items-start justify-between gap-3 text-xs">
              <p className={cn("text-destructive", !error && "invisible")}>
                {error ?? "."}
              </p>
              {remaining < 200 && (
                <p className="shrink-0 tabular-nums text-muted-foreground">
                  {remaining}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={send} disabled={!message.trim() || sending}>
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {sending ? t("feedback.sending") : t("feedback.send")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

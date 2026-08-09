"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { StickyNote } from "lucide-react";
import { useUpdateTransactionNotes } from "@/hooks/use-transactions";
import { MAX_NOTE_LENGTH, sanitizeNote } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/client";

interface NotesEditorProps {
  transactionId: string;
  initialNotes: string | null;
}

/** Inline note viewer/editor: click to edit, blur or Enter to save (optimistic). */
export function NotesEditor({ transactionId, initialNotes }: NotesEditorProps) {
  const { t } = useI18n();
  const [notes, setNotes] = useState(initialNotes);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const updateNotes = useUpdateTransactionNotes();

  const save = () => {
    setEditing(false);
    const next = sanitizeNote(draft);
    if (next === notes) return;
    const previous = notes;
    setNotes(next);
    updateNotes.mutate(
      { transactionId, notes: next },
      {
        onError: (err) => {
          console.error("Failed to save note:", err);
          setNotes(previous);
        },
      }
    );
  };

  if (editing) {
    return (
      <Textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Don't let Escape bubble up and close the dialog
            e.stopPropagation();
            setEditing(false);
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        maxLength={MAX_NOTE_LENGTH}
        rows={2}
        placeholder={t("notes.placeholder")}
        className="flex-1 min-h-[60px] text-sm"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(notes ?? "");
        setEditing(true);
      }}
      className="flex-1 min-w-0 text-left text-sm rounded-md px-2 py-1 hover:bg-accent transition-colors"
    >
      {notes ? (
        <span className="font-medium whitespace-pre-wrap break-words">{notes}</span>
      ) : (
        <span className="text-muted-foreground flex items-center gap-1">
          <StickyNote className="h-3 w-3" />
          {t("tx.menu.addNote")}
        </span>
      )}
    </button>
  );
}

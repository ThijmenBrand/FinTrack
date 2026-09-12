"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { ExternalLink, Eye, FileText, Loader2, Paperclip, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { ApiError } from "@/lib/api";
import { useAttachments, useDeleteAttachment, useUploadAttachment } from "@/hooks/use-attachments";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  MAX_ATTACHMENT_BYTES,
  attachmentSrc,
  formatFileSize,
  isImageAttachment,
} from "@/lib/attachments";
import type { TransactionAttachment } from "@/types/api";

/** One stored file, as a 56px preview that opens the viewer. */
function AttachmentTile({
  attachment,
  onOpen,
}: {
  attachment: TransactionAttachment;
  onOpen: () => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("attachments.view", { name: attachment.fileName })}
      title={attachment.fileName}
      className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted/40 transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {isImageAttachment(attachment.contentType) ? (
        // ponytail: plain <img>, not next/image — same reason as UserAvatar.
        // The optimizer refetches server-side without the session cookie, and
        // these bytes only exist behind one.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachmentSrc(attachment.id)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-muted-foreground">
          <FileText className="h-5 w-5" />
          <span className="text-[9px] font-semibold tracking-wider">PDF</span>
        </span>
      )}
      {/* The tile is a preview, so hover/focus says what clicking it does. */}
      <span className="absolute inset-0 flex items-center justify-center bg-foreground/55 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
        <Eye className="h-4 w-4 text-background" />
      </span>
    </button>
  );
}

/** Full view of one file, and the only place it can be removed from. */
function AttachmentViewer({
  attachment,
  onClose,
  onRemove,
  removing,
  readOnly,
}: {
  attachment: TransactionAttachment;
  onClose: () => void;
  onRemove: () => void | Promise<void>;
  removing: boolean;
  readOnly?: boolean;
}) {
  const { t, formatDateTime } = useI18n();
  const src = attachmentSrc(attachment.id);
  const isImage = isImageAttachment(attachment.contentType);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate pr-6 text-base font-semibold">
            {attachment.fileName}
          </DialogTitle>
          <DialogDescription>
            {formatFileSize(attachment.size)} · {formatDateTime(attachment.createdAt)}
          </DialogDescription>
        </DialogHeader>

        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={attachment.fileName}
            className="max-h-[62vh] w-full rounded-md border bg-muted/30 object-contain"
          />
        ) : (
          // ponytail: the browser's own PDF viewer in an iframe — no pdf.js.
          // Only /api/attachments/* is framable (next.config.ts); the rest of
          // the app still sends X-Frame-Options DENY. Mobile Safari renders
          // just the first page in a frame, which is what the button is for.
          <iframe
            // Chrome/Firefox honour the fragment: fit the page to the frame's
            // width and skip the thumbnail rail, which a one-page receipt
            // doesn't need and which costs half the dialog.
            src={`${src}#navpanes=0&view=FitH`}
            title={attachment.fileName}
            className="h-[62vh] w-full rounded-md border bg-muted/30"
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={src} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {t("attachments.openInNewTab")}
            </a>
          </Button>
          {!readOnly && (
            <div className="ml-auto">
              <ConfirmDeleteButton
                variant="text"
                label={t("attachments.remove")}
                confirmLabel={t("attachments.remove")}
                message={t("attachments.removeConfirm")}
                pending={removing}
                onConfirm={onRemove}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface AttachmentStripProps {
  attachments: TransactionAttachment[];
  /** Names of the files whose upload is still in flight, in pick order. */
  uploading: string[];
  error: string | null;
  onPick: (files: File[]) => void;
  onRemove: (attachment: TransactionAttachment) => void | Promise<void>;
  removing: boolean;
  /**
   * Viewer on a shared account: the files are theirs to read, and every write
   * the server would reject is simply not offered.
   */
  readOnly?: boolean;
}

/**
 * Tile strip with an add control, shared by the transaction detail dialog and
 * the CSV import review rows so a receipt looks and behaves the same in both.
 *
 * Empty, it is one ghost button — the same "Add note" grammar the row above it
 * uses. Once there are files it becomes a strip of previews plus a dashed add
 * tile.
 */
function AttachmentStrip({
  attachments,
  uploading,
  error,
  onPick,
  onRemove,
  removing,
  readOnly,
}: AttachmentStripProps) {
  const { t, plural } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const shown = attachments.find((a) => a.id === viewing) ?? null;

  const total = attachments.length + uploading.length;
  const full = total >= MAX_ATTACHMENTS_PER_TRANSACTION;
  const empty = total === 0;

  const picker = readOnly ? null : (
    <input
      ref={fileInput}
      type="file"
      accept={ATTACHMENT_ACCEPT}
      multiple
      className="sr-only"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        // Let the same file be picked again after a failure.
        e.target.value = "";
        if (files.length) onPick(files);
      }}
    />
  );

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      {picker}

      {empty && readOnly ? (
        <span className="text-muted-foreground">—</span>
      ) : empty ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fileInput.current?.click()}
          // px-2 + no negative margin lines the label up with the "Add note"
          // button directly above it in the detail dialog.
          className="h-7 gap-1.5 px-2 text-sm font-normal text-muted-foreground"
        >
          <Paperclip className="h-3.5 w-3.5" />
          {t("attachments.add")}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {attachments.map((a) => (
            <AttachmentTile key={a.id} attachment={a} onOpen={() => setViewing(a.id)} />
          ))}

          {uploading.map((name, i) => (
            <span
              key={`${name}-${i}`}
              title={t("attachments.uploading")}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/40"
            >
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </span>
          ))}

          {!full && !readOnly && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label={t("attachments.addAnother")}
              title={t("attachments.addAnother")}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {full && !readOnly && (
        <p className="text-xs text-muted-foreground">
          {t("attachments.limitReached", { max: MAX_ATTACHMENTS_PER_TRANSACTION })}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {/* Screen readers get the count the tiles convey visually. */}
      {!empty && (
        <p className="sr-only">
          {plural(total, "attachments.attached.one", "attachments.attached.other")}
        </p>
      )}

      {shown && (
        <AttachmentViewer
          attachment={shown}
          removing={removing}
          readOnly={readOnly}
          onClose={() => setViewing(null)}
          onRemove={async () => {
            await onRemove(shown);
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Upload queue shared by both call sites: files go up one at a time, each one
 * shows as a spinner tile until its row comes back, and the first failure
 * stops the rest rather than firing five doomed requests.
 */
function useUploadQueue(
  target: { transactionId?: string; accountId?: string },
  onUploaded?: (attachment: TransactionAttachment) => void,
) {
  const { t } = useI18n();
  const upload = useUploadAttachment();
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Drop one occurrence of each name — a second pick may be in flight. */
  const clearNames = (names: string[]) =>
    setUploading((prev) => {
      const rest = [...prev];
      for (const name of names) {
        const i = rest.indexOf(name);
        if (i >= 0) rest.splice(i, 1);
      }
      return rest;
    });

  const pick = async (files: File[], room: number) => {
    setError(null);
    const accepted: File[] = [];
    for (const file of files.slice(0, room)) {
      // Checked here as well as on the server so an oversized photo fails
      // instantly instead of after the upload.
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(t("attachments.tooLarge"));
        continue;
      }
      accepted.push(file);
    }
    if (files.length > room) {
      setError(t("attachments.limitReached", { max: MAX_ATTACHMENTS_PER_TRANSACTION }));
    }
    if (!accepted.length) return;

    const names = accepted.map((f) => f.name);
    // Appended, not assigned: picking again while a batch is still going would
    // otherwise replace the in-flight spinners and leave the count wrong.
    setUploading((prev) => [...prev, ...names]);
    for (const [i, file] of accepted.entries()) {
      try {
        const attachment = await upload.mutateAsync({ file, ...target });
        onUploaded?.(attachment);
        clearNames([file.name]);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t("common.somethingWentWrong"));
        // Only this batch's remaining tiles; another pick's are still real.
        clearNames(names.slice(i));
        return;
      }
    }
  };

  return { pick, uploading, error, setError };
}

/**
 * The attachments on a saved transaction. Reads them on open, so a row shared
 * with someone else shows what they added too.
 */
export function TransactionAttachments({
  transactionId,
  readOnly,
}: {
  transactionId: string;
  readOnly?: boolean;
}) {
  const { data: attachments = [] } = useAttachments(transactionId);
  const remove = useDeleteAttachment();
  const { pick, uploading, error } = useUploadQueue({ transactionId });

  return (
    <AttachmentStrip
      attachments={attachments}
      uploading={uploading}
      error={error}
      removing={remove.isPending}
      readOnly={readOnly}
      onPick={(files) =>
        pick(files, MAX_ATTACHMENTS_PER_TRANSACTION - attachments.length - uploading.length)
      }
      onRemove={async (a) => {
        await remove.mutateAsync({ id: a.id, transactionId });
      }}
    />
  );
}

/**
 * Attachments on a CSV row that hasn't been imported yet. The files are stored
 * straight away — unclaimed, against the target account — and the commit binds
 * them to the row it creates; the ids it needs live on the review row itself.
 */
export function ImportAttachments({
  accountId,
  attachments,
  onChange,
}: {
  accountId: string;
  attachments: TransactionAttachment[];
  /**
   * Updater, not a value: a multi-file pick uploads one after another, and a
   * callback that closed over `attachments` would hand the row a list built
   * from the state as it was when the pick started — keeping only the last file.
   */
  onChange: (update: (prev: TransactionAttachment[]) => TransactionAttachment[]) => void;
}) {
  const remove = useDeleteAttachment();
  // `attachments` is the review row's own state, so the queue appends to it as
  // each upload lands rather than refetching anything.
  const { pick, uploading, error } = useUploadQueue({ accountId }, (a) =>
    onChange((prev) => [...prev, a]),
  );

  return (
    <AttachmentStrip
      attachments={attachments}
      uploading={uploading}
      error={error}
      removing={remove.isPending}
      onPick={(files) =>
        pick(files, MAX_ATTACHMENTS_PER_TRANSACTION - attachments.length - uploading.length)
      }
      onRemove={async (a) => {
        await remove.mutateAsync({ id: a.id });
        onChange((prev) => prev.filter((x) => x.id !== a.id));
      }}
    />
  );
}

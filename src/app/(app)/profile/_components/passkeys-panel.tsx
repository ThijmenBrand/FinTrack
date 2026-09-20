"use client";

import { useState } from "react";
import { Fingerprint, Plus, Trash2 } from "lucide-react";
import { SettingsPanel } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { usePasskeys, type PasskeyItem } from "@/hooks/use-passkey";
import { useIsHydrated } from "@/hooks/use-browser";
import { useI18n } from "@/lib/i18n/client";
import { FormMessage, type FormMessageState } from "./form-message";
import { AddPasskeyDialog, RemovePasskeyDialog } from "./passkey-dialogs";

/**
 * Passkeys get their own panel because they are a list, not a setting: the
 * rows grow, each one is separately removable, and the panel's header action
 * is the only way to add one. Every row says what the thing is and when it was
 * added, so you can tell the laptop from the phone before deleting one.
 */
export function PasskeysPanel() {
  const { t, formatDate } = useI18n();
  // Only knowable in the browser, so not until after hydration.
  const hydrated = useIsHydrated();
  const supported = hydrated && !!window.PublicKeyCredential;
  const { data: passkeys = [], isLoading } = usePasskeys(supported);

  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<PasskeyItem | null>(null);
  const [message, setMessage] = useState<FormMessageState>(null);

  /**
   * When it was added and whether it travels — the two things that tell two
   * otherwise identical rows apart. Empty for a passkey that reports neither.
   */
  function describe(passkey: PasskeyItem) {
    const parts: string[] = [];
    if (passkey.createdAt) {
      parts.push(
        t("profile.passkey.added", { date: formatDate(passkey.createdAt) }),
      );
    }
    if (passkey.deviceType === "multiDevice") {
      parts.push(t("profile.passkey.synced"));
    } else if (passkey.deviceType === "singleDevice") {
      parts.push(t("profile.passkey.singleDevice"));
    }
    return parts.join(" · ");
  }

  return (
    <>
      <SettingsPanel
        title="profile.passkeys.title"
        description="profile.passkeys.description"
        icon={Fingerprint}
        // Skeleton until the browser has answered: rendering "not supported"
        // for one frame on every load would be a lie we then take back.
        loading={!hydrated || isLoading}
        loadingRows={1}
        action={
          supported && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMessage(null);
                setAddOpen(true);
              }}
            >
              <Plus />
              {t("profile.passkey.add")}
            </Button>
          )
        }
        footer={message && <FormMessage message={message} className="text-xs" />}
      >
        {!supported ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            {t("profile.passkey.unsupported")}
          </p>
        ) : passkeys.length === 0 ? (
          <div className="px-5 py-4">
            <p className="text-sm font-medium leading-snug">
              {t("profile.passkey.none")}
            </p>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {t("profile.passkey.noneHint")}
            </p>
          </div>
        ) : (
          passkeys.map((passkey) => {
            const name = passkey.name || t("profile.passkey.fallbackName");
            const detail = describe(passkey);
            return (
              <div
                key={passkey.id}
                className="flex items-center justify-between gap-4 px-5 py-3.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-snug">
                      {name}
                    </p>
                    {detail && (
                      <p className="truncate text-xs text-muted-foreground">
                        {detail}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setMessage(null);
                    setRemoving(passkey);
                  }}
                  aria-label={t("profile.passkey.removeNamed", { name })}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })
        )}
      </SettingsPanel>

      <AddPasskeyDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() =>
          setMessage({
            type: "success",
            text: t("profile.passkey.registered_success"),
          })
        }
      />
      <RemovePasskeyDialog
        passkey={removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        onRemoved={() =>
          setMessage({ type: "success", text: t("profile.passkey.removed") })
        }
      />
    </>
  );
}

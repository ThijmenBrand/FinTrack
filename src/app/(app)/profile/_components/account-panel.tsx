"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2, User } from "lucide-react";
import {
  SettingsPanel,
  SettingsRow,
  SaveStatus,
} from "@/components/settings/settings-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { useSessionUser } from "@/components/nav-shared";
import {
  useDeleteAvatar,
  useUpdateProfile,
  useUploadAvatar,
} from "@/hooks/use-profile";
import { useResetOnChange } from "@/hooks/use-reset-on-change";
import { ApiError } from "@/lib/api";
import { AVATAR_ACCEPT, MAX_AVATAR_BYTES } from "@/lib/avatar";
import { MAX_USERNAME_LENGTH } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/client";
import type { Profile } from "@/types/api";
import { FormMessage, type FormMessageState } from "./form-message";

/**
 * Who you are. Autosaving like every other settings row — the display name
 * commits when you leave the field, so the panel needs no Save button and no
 * dirty state, and the header says "Saved" the way the rest of settings does.
 */
export function AccountPanel({ profile }: { profile: Profile }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();

  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();
  const { refetch: refetchSession } = useSessionUser();
  const fileInput = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pictureMsg, setPictureMsg] = useState<FormMessageState>(null);
  // Local object URL so the new face shows before the round-trip finishes.
  const [preview, setPreview] = useState<string | null>(null);

  // Keyed on the name itself, not the profile object: a background refetch
  // returning the same name mustn't stomp what you're halfway through typing.
  useResetOnChange(profile.displayName, () => {
    setDisplayName(profile.displayName);
    setNameError(null);
  });

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const pictureBusy = uploadAvatar.isPending || deleteAvatar.isPending;

  async function commitName() {
    const next = displayName.trim();
    if (!next) {
      // An empty box isn't an instruction to erase your name.
      setDisplayName(profile.displayName);
      setNameError(null);
      return;
    }
    if (next === profile.displayName) {
      setNameError(null);
      return;
    }
    setNameError(null);
    try {
      await updateProfile.mutateAsync({ displayName: next });
      await refetchSession();
      router.refresh();
    } catch (err) {
      setNameError(
        err instanceof ApiError ? err.message : t("profile.updateFailed"),
      );
    }
  }

  async function handlePictureChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Let the same file be picked again after a failure.
    e.target.value = "";
    if (!file) return;
    setPictureMsg(null);

    if (file.size > MAX_AVATAR_BYTES) {
      setPictureMsg({ type: "error", text: t("profile.pictureTooLarge") });
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    try {
      await uploadAvatar.mutateAsync(file);
      await refetchSession();
    } catch (err) {
      setPreview(null);
      setPictureMsg({
        type: "error",
        text: err instanceof Error ? err.message : t("profile.pictureFailed"),
      });
    }
  }

  async function handlePictureRemove() {
    setPictureMsg(null);
    try {
      await deleteAvatar.mutateAsync();
      setPreview(null);
      await refetchSession();
    } catch (err) {
      setPictureMsg({
        type: "error",
        text: err instanceof ApiError ? err.message : t("profile.pictureFailed"),
      });
    }
  }

  return (
    <SettingsPanel
      title="profile.account.title"
      description="profile.account.description"
      icon={User}
      action={
        <SaveStatus pending={updateProfile.isPending || pictureBusy} />
      }
    >
      {/* Hand-built rather than a SettingsRow: the face belongs left of its own
          label, and a row whose left column is one stacked text block can't do
          that. Same gutters, so it still sits flush with the rows below. */}
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar
            name={profile.displayName}
            image={preview ?? profile.imageUrl}
            className="h-14 w-14 text-lg"
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium leading-snug">
              {t("profile.picture.label")}
            </p>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              {t("profile.pictureHint")}
            </p>
            <FormMessage message={pictureMsg} className="text-xs" />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:min-w-[11rem] sm:justify-end">
          <input
            ref={fileInput}
            type="file"
            accept={AVATAR_ACCEPT}
            className="sr-only"
            onChange={handlePictureChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pictureBusy}
            onClick={() => fileInput.current?.click()}
          >
            {uploadAvatar.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Camera />
            )}
            {t("profile.uploadPicture")}
          </Button>
          {(profile.imageUrl || preview) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pictureBusy}
              onClick={handlePictureRemove}
            >
              <Trash2 />
              {t("profile.removePicture")}
            </Button>
          )}
        </div>
      </div>

      <SettingsRow
        htmlFor="displayName"
        label={t("profile.displayName")}
        hint={t("profile.displayNameHint")}
        control={
          <Input
            id="displayName"
            type="text"
            autoComplete="name"
            className="w-full sm:w-44"
            value={displayName}
            maxLength={MAX_USERNAME_LENGTH}
            aria-invalid={nameError ? true : undefined}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={commitName}
            // Enter is what people press to mean "done"; blurring commits it
            // through the one code path instead of a second one.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        }
      >
        {nameError && <p className="text-xs text-destructive">{nameError}</p>}
      </SettingsRow>

      <SettingsRow
        label={t("profile.email")}
        hint={t("profile.emailHint")}
        control={
          // Bounded and truncating: an address long enough to push the rail
          // wide would squeeze every label on the page, not just this one.
          <span
            title={profile.email}
            className="max-w-[16rem] truncate text-sm text-muted-foreground"
          >
            {profile.email}
          </span>
        }
      />

      <SettingsRow
        label={t("profile.role")}
        hint={
          profile.isAdmin
            ? t("profile.roleAdminHint")
            : t("profile.roleUserHint")
        }
        control={
          <Badge variant={profile.isAdmin ? "default" : "secondary"}>
            {profile.isAdmin ? t("profile.roleAdmin") : t("profile.roleUser")}
          </Badge>
        }
      />

      <SettingsRow
        label={t("profile.memberSince")}
        control={
          <span className="text-sm text-muted-foreground">
            {formatDate(profile.createdAt)}
          </span>
        }
      />
    </SettingsPanel>
  );
}

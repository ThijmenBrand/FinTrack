"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { User, Save, Loader2, Camera, Trash2 } from "lucide-react";
import {
  useUpdateProfile,
  useUploadAvatar,
  useDeleteAvatar,
} from "@/hooks/use-profile";
import { ApiError } from "@/lib/api";
import type { Profile } from "@/types/api";
import { FormMessage, type FormMessageState } from "./form-message";
import { useI18n } from "@/lib/i18n/client";
import { UserAvatar } from "@/components/user-avatar";
import { useSessionUser } from "@/components/nav-shared";
import { AVATAR_ACCEPT, MAX_AVATAR_BYTES } from "@/lib/avatar";
import { useResetOnChange } from "@/hooks/use-reset-on-change";

export function ProfileCard({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const router = useRouter();
  const updateProfile = useUpdateProfile();

  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();
  const { refetch: refetchSession } = useSessionUser();
  const fileInput = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<FormMessageState>(null);
  // Local object URL so the new face shows before the round-trip finishes.
  const [preview, setPreview] = useState<string | null>(null);

  useResetOnChange(profile, () => setDisplayName(profile.displayName));

  // Drop the preview once the server URL has landed, and free the blob handle.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const busy = uploadAvatar.isPending || deleteAvatar.isPending;

  async function handlePictureChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Let the same file be picked again after a failure.
    e.target.value = "";
    if (!file) return;
    setProfileMsg(null);

    if (file.size > MAX_AVATAR_BYTES) {
      setProfileMsg({ type: "error", text: t("profile.pictureTooLarge") });
      return;
    }

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    try {
      await uploadAvatar.mutateAsync(file);
      await refetchSession();
      setProfileMsg({ type: "success", text: t("profile.pictureUpdated") });
    } catch (err) {
      setPreview(null);
      setProfileMsg({
        type: "error",
        text: err instanceof Error ? err.message : t("profile.pictureFailed"),
      });
    }
  }

  async function handlePictureRemove() {
    setProfileMsg(null);
    try {
      await deleteAvatar.mutateAsync();
      setPreview(null);
      await refetchSession();
      setProfileMsg({ type: "success", text: t("profile.pictureRemoved") });
    } catch (err) {
      setProfileMsg({
        type: "error",
        text: err instanceof ApiError ? err.message : t("profile.pictureFailed"),
      });
    }
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setSaving(true);
    try {
      await updateProfile.mutateAsync({ displayName });
      setProfileMsg({ type: "success", text: t("profile.updated") });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setProfileMsg({ type: "error", text: err.message });
      } else {
        setProfileMsg({ type: "error", text: t("profile.updateFailed") });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t("profile.personalInfo")}</CardTitle>
            <CardDescription>{t("profile.personalInfoHint")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div className="flex items-center gap-4">
            <UserAvatar
              name={profile.displayName}
              image={preview ?? profile.imageUrl}
              className="h-16 w-16 text-xl"
            />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
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
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploadAvatar.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  {t("profile.uploadPicture")}
                </Button>
                {(profile.imageUrl || preview) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={handlePictureRemove}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t("profile.removePicture")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("profile.pictureHint")}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="displayName" className="text-sm font-medium">
              {t("profile.displayName")}
            </label>
            <Input
              id="displayName"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
          <FormMessage message={profileMsg} />
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t("profile.saveChanges")}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}

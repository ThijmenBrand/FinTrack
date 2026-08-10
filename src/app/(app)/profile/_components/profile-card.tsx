"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { User, Save, Loader2 } from "lucide-react";
import { useUpdateProfile } from "@/hooks/use-profile";
import { ApiError } from "@/lib/api";
import type { Profile } from "@/types/api";
import { FormMessage, type FormMessageState } from "./form-message";
import { useI18n } from "@/lib/i18n/client";

export function ProfileCard({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const router = useRouter();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<FormMessageState>(null);

  useEffect(() => {
    setDisplayName(profile.displayName);
  }, [profile]);

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

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import { ApiError } from "@/lib/api";
import { ProfileCard } from "./_components/profile-card";
import { PasswordCard } from "./_components/password-card";
import { PinCard } from "./_components/pin-card";
import { PasskeyCard } from "./_components/passkey-card";
import { TwoFactorCard } from "./_components/two-factor-card";

export default function ProfilePage() {
  const router = useRouter();
  const { data: profile, isLoading, error } = useProfile();

  // Redirect on 401
  useEffect(() => {
    if (error && (error as ApiError).status === 401) router.push("/login");
  }, [error, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Manage your account settings
        </p>
      </div>

      <ProfileCard profile={profile} />
      <TwoFactorCard enabled={profile.twoFactorEnabled} />
      <PasswordCard />
      <PinCard />
      <PasskeyCard />

      {/* Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Account Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Role</span>
            <span className="font-medium">{profile.isAdmin ? "Admin" : "User"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Member since</span>
            <span className="font-medium">
              {new Date(profile.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

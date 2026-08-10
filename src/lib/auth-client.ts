"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  plugins: [
    adminClient(),
    passkeyClient(),
    twoFactorClient({ twoFactorPage: "/two-factor" }),
  ],
});

export const { useSession, signIn, signOut } = authClient;

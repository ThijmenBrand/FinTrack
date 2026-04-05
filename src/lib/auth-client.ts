"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, usernameClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  plugins: [adminClient(), usernameClient(), passkeyClient()],
});

export const { useSession, signIn, signOut } = authClient;

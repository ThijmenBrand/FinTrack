import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { apiFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

export interface PasskeyItem {
  id: string;
  name?: string | null;
  createdAt?: string | null;
}

export function usePasskeys(enabled: boolean) {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: () => apiFetch<PasskeyItem[]>("/api/auth/passkey/list-user-passkeys"),
    enabled,
  });
}

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; currentPassword: string }) =>
      apiFetch("/api/auth/passkey/delete-passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passkeys"] });
    },
  });
}

export function useRegisterPasskey() {
  const { t } = useI18n();
  return {
    register: async (name?: string) => {
      const result = await authClient.passkey.addPasskey({ name });
      if (result.error) {
        throw new Error(String(result.error.message || t("profile.passkey.registerFailed")));
      }
      return result.data;
    },
  };
}

export function useSignInWithPasskey() {
  const { t } = useI18n();
  return {
    signIn: async () => {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        throw new Error(String(result.error.message || t("auth.biometricFailed")));
      }
      return result.data;
    },
  };
}

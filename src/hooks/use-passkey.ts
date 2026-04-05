import { authClient } from "@/lib/auth-client";

export function useRegisterPasskey() {
  return {
    register: async (name?: string) => {
      const result = await authClient.passkey.addPasskey({ name });
      if (result.error) {
        throw new Error(String(result.error.message || "Failed to register passkey"));
      }
      return result.data;
    },
  };
}

export function useSignInWithPasskey() {
  return {
    signIn: async () => {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        throw new Error(String(result.error.message || "Biometric authentication failed"));
      }
      return result.data;
    },
  };
}

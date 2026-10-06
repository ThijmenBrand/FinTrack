import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { NotificationSettingsView } from "@/lib/notifications/preferences";
import type { DeviceView } from "@/lib/notifications/devices";
import type { Channel, NotificationType } from "@/lib/notifications/types";

export interface NotificationSettingsData extends NotificationSettingsView {
  /** The server's VAPID public key; null when push isn't set up on this server. */
  publicKey: string | null;
  devices: DeviceView[];
}

const KEY = ["notification-settings"];

export function useNotificationSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<NotificationSettingsData>("/api/notifications"),
  });
}

/** Flip one switch, optimistically: the switch moves now, a failure puts it back. */
export function useSetNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { type: NotificationType; channel: Channel; enabled: boolean }) =>
      apiFetch<{ ok: true }>("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<NotificationSettingsData>(KEY);
      if (previous) {
        qc.setQueryData<NotificationSettingsData>(KEY, {
          ...previous,
          groups: previous.groups.map((g) => ({
            ...g,
            types: g.types.map((t) =>
              t.type === v.type && t.channels[v.channel]
                ? { ...t, channels: { ...t.channels, [v.channel]: { ...t.channels[v.channel]!, enabled: v.enabled } } }
                : t,
            ),
          })),
        });
      }
      return { previous };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRemoveDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/api/notifications/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSendTestNotification() {
  return useMutation({
    mutationFn: (endpoint: string) =>
      apiFetch<{ delivered: number }>("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }),
  });
}

export function useInvalidateNotificationSettings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

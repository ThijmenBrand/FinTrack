"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SaveStatus, SettingsHeader, SettingsPanel, SettingsRow } from "@/components/settings/settings-ui";
import {
  useInvalidateNotificationSettings,
  useNotificationSettings,
  useRemoveDevice,
  useSendTestNotification,
  useSetNotificationPreference,
  type NotificationSettingsData,
} from "@/hooks/use-notifications";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { CHANNELS, type NotificationType } from "@/lib/notifications/types";
import {
  currentSubscription,
  hashEndpoint,
  pushSupport,
  registerSubscription,
  subscribe,
  unsubscribeThisDevice,
} from "@/lib/push-client";

const BROWSER_KEY = ["push-browser-state"];

/** What this browser can do and has: read once, refreshed after every change. */
function useBrowserPush() {
  return useQuery({
    queryKey: BROWSER_KEY,
    queryFn: async () => {
      const support = pushSupport();
      const subscription = await currentSubscription();
      return {
        support,
        permission: support === "supported" ? Notification.permission : ("default" as NotificationPermission),
        endpoint: subscription?.endpoint ?? null,
        endpointHash: subscription ? await hashEndpoint(subscription.endpoint) : null,
      };
    },
    staleTime: Infinity,
  });
}

const typeLabel = (type: NotificationType) => `notifications.types.${type}.label` as MessageKey;
const typeHint = (type: NotificationType) => `notifications.types.${type}.hint` as MessageKey;

/**
 * Notifications: this device (turn push on/off, send a test), every device
 * that receives them, and one row per notification type with a switch per
 * channel. The type rows come from the registry, so a new notification
 * appears here without touching this page.
 */
export default function NotificationSettingsPage() {
  const { t } = useI18n();
  const { data, isLoading } = useNotificationSettings();
  const setPreference = useSetNotificationPreference();

  return (
    <div className="max-w-3xl space-y-6">
      <SettingsHeader
        title="settings.notifications.title"
        description="settings.notifications.description"
        actions={<SaveStatus pending={setPreference.isPending} />}
      />

      <DevicePanels data={data} loading={isLoading} />

      {isLoading || !data ? (
        <SettingsPanel loading loadingRows={4}>
          {null}
        </SettingsPanel>
      ) : (
        data.groups.map((group) => (
          <SettingsPanel key={group.group} title={`notifications.group.${group.group}` as MessageKey}>
            {group.types.map(({ type, channels }) => (
              <SettingsRow
                key={type}
                label={t(typeLabel(type))}
                hint={
                  <>
                    {t(typeHint(type))}
                    {channels.email?.locked && (
                      <span className="mt-1 block">{t("settings.notifications.locked")}</span>
                    )}
                  </>
                }
                control={
                  <div className="flex items-start gap-5">
                    {CHANNELS.map((channel) => {
                      const setting = channels[channel];
                      // Keep the columns lined up down the page when a type lacks a channel.
                      if (!setting) return <span key={channel} className="w-10" aria-hidden />;
                      const id = `notify-${type}-${channel}`;
                      return (
                        <label key={channel} htmlFor={id} className="flex w-10 flex-col items-center gap-1.5">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {t(`settings.notifications.channel.${channel}`)}
                          </span>
                          <Switch
                            id={id}
                            checked={setting.enabled}
                            disabled={setting.locked}
                            aria-label={t("settings.notifications.toggleLabel", {
                              type: t(typeLabel(type)),
                              channel: t(`settings.notifications.channel.${channel}`),
                            })}
                            onCheckedChange={(enabled) => setPreference.mutate({ type, channel, enabled })}
                          />
                        </label>
                      );
                    })}
                  </div>
                }
              />
            ))}
          </SettingsPanel>
        ))
      )}
    </div>
  );
}

function DevicePanels({ data, loading }: { data: NotificationSettingsData | undefined; loading: boolean }) {
  const { t, formatDate } = useI18n();
  const qc = useQueryClient();
  const browser = useBrowserPush();
  const invalidateSettings = useInvalidateNotificationSettings();
  const removeDevice = useRemoveDevice();
  const sendTest = useSendTestNotification();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const devices = data?.devices ?? [];
  const state = browser.data;
  // "On" means the server still sends here: a device removed from the list
  // below is off, even though the browser kept its subscription.
  const registered = !!state?.endpointHash && devices.some((d) => d.endpointHash === state.endpointHash);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: BROWSER_KEY });
    await invalidateSettings();
  };

  const turnOn = async () => {
    if (!data?.publicKey) return;
    setBusy(true);
    setError(false);
    try {
      const subscription = await subscribe(data.publicKey);
      if (subscription) {
        const res = await registerSubscription(subscription);
        if (!res.ok) throw new Error(`register ${res.status}`);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const turnOff = async () => {
    setBusy(true);
    await unsubscribeThisDevice();
    setBusy(false);
    await refresh();
  };

  let hint: MessageKey;
  let action: React.ReactNode = null;
  if (!data?.publicKey) {
    hint = "settings.notifications.device.notConfigured";
  } else if (state?.support === "ios-install") {
    hint = "settings.notifications.device.iosInstall";
  } else if (state?.support === "unsupported") {
    hint = "settings.notifications.device.unsupported";
  } else if (state?.permission === "denied") {
    hint = "settings.notifications.device.denied";
  } else if (registered) {
    hint = "settings.notifications.device.on";
    action = (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={sendTest.isPending || !state?.endpoint}
          onClick={() => state?.endpoint && sendTest.mutate(state.endpoint)}
        >
          {sendTest.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BellRing className="mr-1.5 h-3.5 w-3.5" />}
          {sendTest.isSuccess ? t("settings.notifications.device.testSent") : t("settings.notifications.device.test")}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={turnOff}>
          {t("settings.notifications.device.turnOff")}
        </Button>
      </div>
    );
  } else {
    hint = "settings.notifications.device.off";
    action = (
      <Button size="sm" disabled={busy || !state} onClick={turnOn}>
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        {t("settings.notifications.device.turnOn")}
      </Button>
    );
  }

  return (
    <>
      <SettingsPanel title="settings.notifications.device.title" icon={Smartphone} loading={loading || browser.isLoading} loadingRows={1}>
        <SettingsRow
          label={t("settings.notifications.device.label")}
          hint={
            <>
              {t(hint)}
              {error && <span className="mt-1 block text-destructive">{t("settings.notifications.device.error")}</span>}
            </>
          }
          control={action}
        />
      </SettingsPanel>

      {data?.publicKey && (
        <SettingsPanel
          title="settings.notifications.devices.title"
          description="settings.notifications.devices.description"
          loading={loading}
          loadingRows={1}
        >
          {devices.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">{t("settings.notifications.devices.empty")}</p>
          ) : (
            devices.map((device) => (
              <SettingsRow
                key={device.id}
                label={
                  <span className="flex items-center gap-2">
                    {device.label ?? "—"}
                    {device.endpointHash === state?.endpointHash && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {t("settings.notifications.devices.thisDevice")}
                      </span>
                    )}
                  </span>
                }
                hint={t("settings.notifications.devices.added", { date: formatDate(device.createdAt) })}
                control={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removeDevice.isPending}
                    onClick={() => removeDevice.mutate(device.id)}
                  >
                    {t("settings.notifications.devices.remove")}
                  </Button>
                }
              />
            ))
          )}
        </SettingsPanel>
      )}
    </>
  );
}

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import {
  GROUPS,
  NOTIFICATIONS,
  NOTIFICATION_TYPES,
  type Channel,
  type NotificationGroup,
  type NotificationType,
} from "./registry";

export interface ChannelSetting {
  enabled: boolean;
  locked: boolean;
}

export type ChannelSettings = Partial<Record<Channel, ChannelSetting>>;

/** "type:channel" → enabled, as stored. */
export type Overrides = Map<string, boolean>;

const key = (type: string, channel: string) => `${type}:${channel}`;

/**
 * The channels a type may use for this user: the registry's default unless the
 * user changed it, and always on when the registry locks it. Pure.
 */
export function resolveChannels(type: NotificationType, overrides: Overrides): ChannelSettings {
  const out: ChannelSettings = {};
  for (const [channel, rule] of Object.entries(NOTIFICATIONS[type].channels) as [Channel, { default: boolean; locked?: boolean }][]) {
    const locked = !!rule.locked;
    out[channel] = {
      locked,
      enabled: locked ? true : (overrides.get(key(type, channel)) ?? rule.default),
    };
  }
  return out;
}

export async function loadOverrides(userId: string): Promise<Overrides> {
  const rows = await db
    .select({
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  return new Map(rows.map((r) => [key(r.type, r.channel), r.enabled]));
}

export interface NotificationSettingsView {
  groups: {
    group: NotificationGroup;
    types: { type: NotificationType; channels: ChannelSettings }[];
  }[];
}

/** Everything the settings page shows, grouped and ordered by the registry. */
export async function getNotificationSettings(userId: string): Promise<NotificationSettingsView> {
  const overrides = await loadOverrides(userId);
  return {
    groups: GROUPS.map((group) => ({
      group,
      types: NOTIFICATION_TYPES.filter((type) => NOTIFICATIONS[type].group === group).map((type) => ({
        type,
        channels: resolveChannels(type, overrides),
      })),
    })).filter((g) => g.types.length > 0),
  };
}

export type SetPreferenceResult = "ok" | "unsupported" | "locked";

/** Store one switch. The caller has already checked `type` and `channel` are known values. */
export async function setNotificationPreference(
  userId: string,
  type: NotificationType,
  channel: Channel,
  enabled: boolean,
): Promise<SetPreferenceResult> {
  const rule = NOTIFICATIONS[type].channels[channel];
  if (!rule) return "unsupported";
  if (rule.locked) return "locked";
  const now = new Date().toISOString();
  await db
    .insert(notificationPreferences)
    .values({ userId, type, channel, enabled, updatedAt: now })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.type, notificationPreferences.channel],
      set: { enabled, updatedAt: now },
    });
  return "ok";
}

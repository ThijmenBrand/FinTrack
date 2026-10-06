import { createECDH } from "node:crypto";
import { describe, it, expect } from "vitest";
import { getI18nFor } from "@/lib/i18n/translate";
import { LOCALES } from "@/lib/i18n";
import { classifyBudgetLine } from "./evaluators/budget";
import { findShortfalls } from "./evaluators/bills";
import { describeDevice, deviceKey } from "./device";
import { resolveChannels } from "./preferences";
import { isAllowedPushEndpoint, isPushKey } from "./push";
import { NOTIFICATIONS, NOTIFICATION_TYPES, type NotificationData, type NotificationType } from "./registry";
import { dailyRunDue, localDateHour } from "./schedule";

describe("classifyBudgetLine", () => {
  it("is over once spending passes the limit", () => {
    expect(classifyBudgetLine({ spent: 450.01, limit: 450, progress: 0.4 })).toEqual({ kind: "over" });
    // Exactly at the limit near month end: not over, and no pace left to warn about.
    expect(classifyBudgetLine({ spent: 450, limit: 450, progress: 0.95 })).toBeNull();
  });

  it("warns about pace once the projection runs 20% over", () => {
    // 10 of 30 days, €130 of €200 spent → €390 projected.
    expect(classifyBudgetLine({ spent: 130, limit: 200, progress: 1 / 3 })).toEqual({ kind: "pace", projected: 390 });
    // €110 → €330 projected: over 1.2 × 200, and more than half spent.
    expect(classifyBudgetLine({ spent: 110, limit: 200, progress: 1 / 3 })?.kind).toBe("pace");
    // On track: €60 of €200 by day 10.
    expect(classifyBudgetLine({ spent: 60, limit: 200, progress: 1 / 3 })).toBeNull();
  });

  it("stays quiet early in the month and below half the budget", () => {
    // Day 3: one big shop is not a trend.
    expect(classifyBudgetLine({ spent: 150, limit: 200, progress: 0.1 })).toBeNull();
    // Projection is high but less than half is spent.
    expect(classifyBudgetLine({ spent: 90, limit: 200, progress: 0.25 })).toBeNull();
  });

  it("ignores lines without a cap", () => {
    expect(classifyBudgetLine({ spent: 20, limit: 0, progress: 0.5 })).toBeNull();
  });
});

describe("findShortfalls", () => {
  const account = { id: "a", name: "Checking", type: "checking", balance: 950 };
  const event = (date: string, daysUntil: number, amount: number, description = "Rent") => ({
    accountId: "a",
    date,
    daysUntil,
    amount,
    description,
    overdue: false,
  });

  it("warns at the bill that takes the account below zero", () => {
    const out = findShortfalls(
      [event("2026-10-07", 1, -400, "Insurance"), event("2026-10-08", 2, -1200)],
      [account],
    );
    expect(out).toEqual([
      {
        accountId: "a",
        accountName: "Checking",
        balance: 950,
        shortfall: 650,
        date: "2026-10-08",
        bills: [
          { description: "Insurance", amount: 400, date: "2026-10-07" },
          { description: "Rent", amount: 1200, date: "2026-10-08" },
        ],
      },
    ]);
  });

  it("counts income that lands first, including on the same day", () => {
    expect(findShortfalls([event("2026-10-08", 2, -1200), event("2026-10-08", 2, 2500, "Salary")], [account])).toEqual([]);
  });

  it("ignores bills beyond the horizon, overdue ones, and credit accounts", () => {
    expect(findShortfalls([event("2026-10-12", 6, -1200)], [account])).toEqual([]);
    expect(findShortfalls([{ ...event("2026-10-05", -1, -1200), overdue: true }], [account])).toEqual([]);
    expect(findShortfalls([event("2026-10-07", 1, -1200)], [{ ...account, type: "credit" }])).toEqual([]);
  });
});

describe("push endpoint allowlist", () => {
  it("accepts the real push services", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://jmt17.google.com/fcm/send/dIyco--crRo:APA91bE8",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-db5p.notify.windows.com/w/?token=abc",
    ]) {
      expect(isAllowedPushEndpoint(url), url).toBe(true);
    }
  });

  it("refuses anything the server shouldn't call", () => {
    for (const url of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com.evil.example/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/api",
      "https://notify.windows.com.evil.example/x",
      "https://jmt17.google.com.evil.example/x",
      "https://mail.google.com/x",
      "not a url",
      `https://fcm.googleapis.com/${"a".repeat(2000)}`,
    ]) {
      expect(isAllowedPushEndpoint(url), url).toBe(false);
    }
    expect(isAllowedPushEndpoint(42)).toBe(false);
  });

  it("checks key shape", () => {
    expect(isPushKey(createECDH("prime256v1").generateKeys("base64url"), 200)).toBe(true);
    expect(isPushKey("has spaces", 200)).toBe(false);
    expect(isPushKey("", 200)).toBe(false);
  });
});

describe("resolveChannels", () => {
  it("uses the registry default until the user changes it", () => {
    expect(resolveChannels("budget.over", new Map())).toEqual({ push: { enabled: true, locked: false } });
    expect(resolveChannels("budget.over", new Map([["budget.over:push", false]]))).toEqual({
      push: { enabled: false, locked: false },
    });
  });

  it("keeps a locked channel on whatever is stored", () => {
    expect(resolveChannels("security.bank", new Map([["security.bank:email", false]])).email).toEqual({
      enabled: true,
      locked: true,
    });
  });
});

describe("registry", () => {
  const samples: { [K in NotificationType]: NotificationData[K] } = {
    "budget.over": { planId: "p", categoryId: "c", categoryName: "Groceries", spent: 512, limit: 450, monthStart: "2026-10-01" },
    "budget.pace": { planId: "p", categoryId: "c", categoryName: "Eating out", spent: 130, limit: 200, monthStart: "2026-10-01", projected: 390 },
    "bills.low_balance": {
      accountId: "a",
      accountName: "Checking",
      balance: 950,
      shortfall: 250,
      date: "2026-10-08",
      bills: [{ description: "Rent", amount: 1200, date: "2026-10-08" }],
    },
    "subscription.detected": {
      merchant: "Netflix",
      amount: 13.99,
      frequency: "monthly",
      accountId: "a",
      categoryId: "c",
      count: 3,
      firstDate: "2026-08-04",
      lastDate: "2026-10-04",
    },
    "bank.consent_expiring": { connectionId: "x", bank: "ING", date: "2026-10-20" },
    "security.bank": { event: "bankConnected", bank: "ING" },
    "security.account": { event: "newDevice", device: "Chrome · macOS" },
  };

  it.each(LOCALES)("words every type fully in %s", (locale) => {
    const i18n = getI18nFor(locale);
    for (const type of NOTIFICATION_TYPES) {
      const def = NOTIFICATIONS[type] as (typeof NOTIFICATIONS)["budget.over"];
      const data = samples[type] as NotificationData["budget.over"];
      const rendered = [def.render(data, i18n), ...(def.summarize ? [def.summarize([data, data, data], i18n)] : [])];
      for (const r of rendered) {
        // No key echoed back and no placeholder left unfilled.
        expect(r.title, type).not.toMatch(/notifications\.|email\.|\{\w+\}/);
        expect(r.body, type).not.toMatch(/notifications\.|email\.|\{\w+\}/);
        expect(r.url.startsWith("/"), type).toBe(true);
      }
    }
  });

  it("only offers email where it can send one", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (NOTIFICATIONS[type].channels.email) expect(NOTIFICATIONS[type].email, type).toBeTypeOf("function");
    }
  });

  it("links a detected subscription to a pre-filled recurring form", () => {
    const r = NOTIFICATIONS["subscription.detected"].render(samples["subscription.detected"], getI18nFor("en"));
    const url = new URL(r.url, "https://x");
    expect(url.pathname).toBe("/recurring");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      add: "expense",
      description: "Netflix",
      amount: "13.99",
      frequency: "monthly",
      accountId: "a",
      categoryId: "c",
    });
  });
});

describe("describeDevice", () => {
  it("names common browsers and systems", () => {
    expect(
      describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1").label,
    ).toBe("Safari · iPhone");
    expect(
      describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36").label,
    ).toBe("Chrome · macOS");
    expect(
      describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0").label,
    ).toBe("Edge · Windows");
    expect(describeDevice(null).label).toBe("Browser · Unknown");
  });

  it("gives the same key to the same kind of device", () => {
    const a = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    const b = a.replace("140.0.0.0", "141.0.0.0");
    expect(deviceKey(a)).toBe(deviceKey(b));
    expect(deviceKey(a)).not.toBe(deviceKey(a.replace("Chrome/140.0.0.0 ", "")));
  });
});

describe("dailyRunDue", () => {
  it("reads the hour in the app's zone, not UTC", () => {
    // 06:30 UTC is 08:30 in Amsterdam (summer time).
    expect(localDateHour(new Date("2026-07-01T06:30:00Z"), "Europe/Amsterdam")).toEqual({ date: "2026-07-01", hour: 8 });
  });

  it("runs once per local day, from 08:00", () => {
    const tz = "Europe/Amsterdam";
    expect(dailyRunDue(new Date("2026-07-01T05:30:00Z"), null, tz)).toBeNull(); // 07:30 local
    expect(dailyRunDue(new Date("2026-07-01T06:00:00Z"), null, tz)).toBe("2026-07-01");
    expect(dailyRunDue(new Date("2026-07-01T15:00:00Z"), "2026-07-01", tz)).toBeNull();
    expect(dailyRunDue(new Date("2026-07-02T06:15:00Z"), "2026-07-01", tz)).toBe("2026-07-02");
  });
});

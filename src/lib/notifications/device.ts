import { createHash } from "node:crypto";

/**
 * A rough "which device is this" from a user agent: enough to label a push
 * subscription ("Safari · iPhone") and to tell a sign-in from a browser the
 * user never used before. Not a fingerprint — two Chromes on two Windows
 * laptops look the same, and that's fine for a heads-up.
 */
export function describeDevice(userAgent: string | null | undefined): {
  browser: string;
  os: string;
  label: string;
} {
  const ua = userAgent ?? "";
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\/|Chromium\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : "Unknown";
  return { browser, os, label: `${browser} · ${os}` };
}

/** Stable short key for "this kind of device", for the known-device ledger. */
export function deviceKey(userAgent: string | null | undefined): string {
  const { browser, os } = describeDevice(userAgent);
  return createHash("sha256").update(`${browser}|${os}`).digest("hex").slice(0, 16);
}

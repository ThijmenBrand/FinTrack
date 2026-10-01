import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import sharp from "sharp";
import { detectImageType } from "@/lib/avatar";

/**
 * Finding a company's logo for a recurring plan — from its name, a website, or
 * a direct image link — and turning it into a small webp we keep ourselves.
 *
 * The CSP only lets the browser load images from our own origin, so nothing
 * here hands out a third-party URL: the server fetches once, re-encodes with
 * sharp (which drops anything that isn't pixels) and the file store keeps the
 * result.
 *
 * Name → domain goes through Clearbit's public company autocomplete; domain →
 * icon through Google's favicon service. Neither needs a key, and both only
 * ever see the plan's name or domain — never an amount or who is asking.
 */

/** Edge of the stored square. Twice the largest place it's drawn (the detail header). */
export const LOGO_SIZE = 128;
/** What a single download may weigh before it's abandoned. */
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
/** Longest link the logo field accepts. */
const MAX_LOGO_INPUT = 2000;

const IMAGE_PATH = /\.(png|jpe?g|webp|gif)$/i;
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

// ─── Address guard ───────────────────────────────────────────────────────────
// A pasted image link makes the server fetch a URL the user chose. Without
// this, that's a way to reach the VPS's own services or the cloud metadata
// endpoint; the check runs inside the socket's own DNS lookup, so the address
// that was vetted is the one that gets dialled (no rebinding window).

// Two lists, not one: BlockList also checks an IPv4 address against IPv6 rules
// in their IPv4-mapped form, so ::ffff:0:0/96 in a shared list blocks all of v4.
const BLOCKED_V4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_V4.addSubnet(net, prefix, "ipv4");
}
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["::", 96], // unspecified, loopback and the old IPv4-compatible form
  ["::ffff:0:0", 96], // IPv4-mapped — would smuggle a private v4 past the list above
  ["64:ff9b::", 96], // NAT64, same reason
  ["64:ff9b:1::", 48], // local-use NAT64
  ["2001::", 32], // Teredo — carries an embedded v4 address
  ["2002::", 16], // 6to4, same
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_V6.addSubnet(net, prefix, "ipv6");
}

/** True for loopback, private, link-local and other addresses no logo lives on. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED_V4.check(address, "ipv4");
  if (family === 6) return BLOCKED_V6.check(address, "ipv6");
  return true;
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const refused: NodeJS.ErrnoException = new Error(`Refusing to connect to ${hostname}`);
      refused.code = "EADDRNOTAVAIL";
      return callback(refused, "", 4);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

/** https on the default port to a named host — an IP literal skips DNS, and with it the guard. */
function isFetchable(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.port === "" || url.port === "443") &&
    !url.username &&
    !url.password &&
    isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0
  );
}

/**
 * GET a URL's body, following a few redirects. Null on anything but a 200 within
 * budget. One deadline covers the whole redirect chain, so a fetch never takes
 * longer than TIMEOUT_MS — the lookup window in recurring-logo relies on that.
 */
function fetchBytes(
  url: URL,
  redirectsLeft = MAX_REDIRECTS,
  deadlineAt = Date.now() + TIMEOUT_MS,
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const remaining = deadlineAt - Date.now();
    if (!isFetchable(url) || remaining <= 0) return resolve(null);

    const req = https.get(
      url,
      {
        lookup: guardedLookup,
        timeout: remaining,
        headers: { "User-Agent": "FinTrack/1.0 (logo lookup)", Accept: "image/*,application/json" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return resolve(null);
          let next: URL;
          try {
            next = new URL(res.headers.location, url);
          } catch {
            return resolve(null);
          }
          return resolve(fetchBytes(next, redirectsLeft - 1, deadlineAt));
        }
        if (status !== 200 || Number(res.headers["content-length"] ?? 0) > MAX_DOWNLOAD_BYTES) {
          res.destroy();
          return resolve(null);
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_DOWNLOAD_BYTES) {
            res.destroy();
            return resolve(null);
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        // Fires after `end` too, where it's a no-op: the promise is settled.
        res.on("close", () => resolve(null));
      },
    );
    // `timeout` is socket idleness; a trickling server still gets cut off here.
    const deadline = setTimeout(() => req.destroy(), remaining);
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

/** Sniffed, decoded and re-encoded to a transparent square — or null if it isn't an image. */
async function toLogo(bytes: Uint8Array | null): Promise<Buffer | null> {
  if (!bytes || !detectImageType(bytes)) return null;
  try {
    return await sharp(bytes, { limitInputPixels: 4096 * 4096 })
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90 })
      .toBuffer();
  } catch {
    return null;
  }
}

// ─── Name and input parsing ──────────────────────────────────────────────────

/** "Basic-Fit B.V." → "basic fit b v": the form names are compared in. */
function wordForm(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Lowercased, without a leading `www.`, and only if it's a plausible public hostname. */
export function normalizeDomain(hostname: string): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  // "127.0.0.1" passes the label pattern; an address is not a company's site.
  return DOMAIN.test(host) && isIP(host) === 0 ? host : null;
}

/**
 * The autocomplete's pick for `name`, when it is clearly the same company.
 *
 * A wrong logo is the real risk, not a missing one: plan names are often plain
 * words ("Salaris", "Mobiel abonnement"), and every Dutch word has some site
 * behind it. So only the top hit counts — the autocomplete ranks real brands
 * first — and only when its company name is the plan name word for word.
 * "Netflix" → netflix.com and "Albert Heijn" → ah.nl pass; "Energie en water"
 * → "Energieen Water" and "Mobiel" → "Mobiel.nl" don't.
 */
export function pickDomain(name: string, suggestions: unknown): string | null {
  const wanted = wordForm(name);
  if (!wanted || !Array.isArray(suggestions)) return null;
  const top: unknown = suggestions[0];
  if (!top || typeof top !== "object") return null;
  const { name: label, domain: raw } = top as { name?: unknown; domain?: unknown };
  if (typeof label !== "string" || typeof raw !== "string" || wordForm(label) !== wanted) return null;
  return normalizeDomain(raw);
}

/**
 * What the user typed into the logo field.
 *
 * - A link ending in an image extension → that image.
 * - Any other link or bare domain ("hbomax.com") → that site's icon.
 * - Anything else ("HBO Max") → a company name to look up.
 */
export type LogoTarget =
  | { kind: "image"; url: URL; domain: string }
  | { kind: "site"; domain: string }
  | { kind: "name"; name: string };

export function parseLogoInput(raw: string): LogoTarget | null {
  const input = raw.trim();
  if (!input || input.length > MAX_LOGO_INPUT) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  // Spaces mean words, not a link; no dot and no scheme means a bare name.
  if (!hasScheme && (/\s/.test(input) || !input.includes("."))) {
    return { kind: "name", name: input };
  }

  let url: URL;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    return hasScheme ? null : { kind: "name", name: input };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const domain = normalizeDomain(url.hostname);
  if (!domain) return null;

  if (IMAGE_PATH.test(url.pathname)) {
    // Fetched over https regardless: a logo isn't worth a cleartext request.
    url.protocol = "https:";
    return { kind: "image", url, domain };
  }
  return { kind: "site", domain };
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

export type FoundLogo = {
  /** Re-encoded webp, LOGO_SIZE square. */
  bytes: Buffer;
  /** Domain or image link it came from — shown back so the user knows. */
  source: string;
};

async function suggestDomain(name: string): Promise<string | null> {
  const body = await fetchBytes(
    new URL(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(name)}`),
  );
  if (!body) return null;
  try {
    return pickDomain(name, JSON.parse(Buffer.from(body).toString("utf8")));
  } catch {
    return null;
  }
}

async function logoFromDomain(domain: string): Promise<FoundLogo | null> {
  const bytes = await toLogo(
    await fetchBytes(
      new URL(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${LOGO_SIZE}`),
    ),
  );
  return bytes ? { bytes, source: domain } : null;
}

/**
 * A plan name's logo. Tries the whole name, then without its last word, so
 * "Spotify Premium" and "Ziggo internet" still land on the brand.
 */
export async function logoFromName(name: string): Promise<FoundLogo | null> {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const attempts = [words.join(" ")];
  if (words.length > 1) attempts.push(words.slice(0, -1).join(" "));

  for (const attempt of attempts) {
    if (wordForm(attempt).replace(/ /g, "").length < 2) continue;
    const domain = await suggestDomain(attempt);
    if (domain) return logoFromDomain(domain);
  }
  return null;
}

/** A logo from what the user typed — see `parseLogoInput`. */
export async function logoFromInput(raw: string): Promise<FoundLogo | null> {
  const target = parseLogoInput(raw);
  if (!target) return null;
  if (target.kind === "name") return logoFromName(target.name);
  if (target.kind === "image") {
    const bytes = await toLogo(await fetchBytes(target.url));
    if (bytes) return { bytes, source: target.url.toString() };
    // Not an image after all (or gone): the site's own icon is the next best.
  }
  return logoFromDomain(target.domain);
}

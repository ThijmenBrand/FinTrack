import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  experimental: {
    viewTransition: true,
  },
  async headers() {
    const base = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
    ];
    // Avatars live in a private Vercel Blob store and are both written and read
    // back through our own routes, so the blob host never appears in a src and
    // 'self' covers it. `blob:` stays for the object-URL preview the file
    // picker shows before upload.
    const csp =
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors ";

    return [
      {
        // Everything but the attachment bytes: never framable, by anyone.
        source: "/((?!api/attachments/).*)",
        headers: [
          ...base,
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: `${csp}'none'` },
        ],
      },
      {
        // A stored receipt is framed by our own viewer dialog, so this one path
        // allows same-origin framing. The bytes are served with a sniffed
        // Content-Type and `nosniff`, and there is no session to click-jack
        // inside a PDF.
        // `:path+`, not `:path*`: `*` would also match the bare
        // /api/attachments collection route, which the negative lookahead
        // above does NOT exclude — that one path would get both header sets.
        source: "/api/attachments/:path+",
        headers: [
          ...base,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: `${csp}'self'` },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Org/project come from SENTRY_ORG / SENTRY_PROJECT env vars. Without
  // SENTRY_AUTH_TOKEN the source-map upload is skipped and the build still works.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Browser events POST same-origin through this route, so the strict
  // `connect-src 'self'` CSP holds and ad-blockers can't drop them.
  tunnelRoute: "/monitoring",
  widenClientFileUpload: true,
  silent: !process.env.CI,
});

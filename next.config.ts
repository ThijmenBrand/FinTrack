import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value:
              // Avatars live in a private Vercel Blob store and are both written
              // and read back through our own routes, so the blob host never
              // appears in a src and 'self' covers it. `blob:` stays for the
              // object-URL preview the file picker shows before upload.
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
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

import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle (server.js + only the node_modules it needs)
  // for the Docker image. Vercel ignores this setting.
  output: "standalone",
  serverExternalPackages: ["@libsql/client"],
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
    // Avatars and receipts live in the server's private file store and are
    // only read back through our own routes, so 'self' covers them. `blob:` stays for the object-URL preview the file
    // picker shows before upload.
    const csp =
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors ";

    // The app is embedded in an iframe on thijmenbrand.nl (and its Vite dev
    // server). X-Frame-Options can't express a cross-origin allowlist, so it
    // is gone entirely — frame-ancestors is what every current browser reads,
    // and leaving DENY/SAMEORIGIN behind would just blank the frame.
    // ponytail: hard-coded origins; move to an env var when a second embedder
    // shows up.
    const frameAncestors = "'self' https://thijmenbrand.nl http://localhost:5173";

    return [
      {
        source: "/((?!api/attachments/).*)",
        headers: [
          ...base,
          { key: "Content-Security-Policy", value: `${csp}${frameAncestors}` },
        ],
      },
      {
        // A stored receipt is framed by our own viewer dialog. Inside the
        // embed its ancestor chain is app + embedder, and frame-ancestors
        // checks the whole chain, so this needs the same list — 'self' alone
        // would blank the receipt viewer when the app is embedded.
        // `:path+`, not `:path*`: `*` would also match the bare
        // /api/attachments collection route, which the negative lookahead
        // above does NOT exclude — that one path would get both header sets.
        source: "/api/attachments/:path+",
        headers: [
          ...base,
          { key: "Content-Security-Policy", value: `${csp}${frameAncestors}` },
        ],
      },
      {
        // The bank sends the user back here with a one-time code and state in
        // the URL. The page wipes them at once; no-referrer makes sure they
        // never leave in a Referer header meanwhile either. Last, because for
        // the same header key the last matching rule wins.
        source: "/settings/bank-connections/callback",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
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

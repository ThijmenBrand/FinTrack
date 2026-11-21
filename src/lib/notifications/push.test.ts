/**
 * Contract test against the REAL `web-push`, deliberately unmocked.
 *
 * Everywhere else the library is replaced by a recorder (see
 * notifications-db.test.ts), and `@types/web-push` is still published for v3
 * while we run v4 — so neither the compiler nor the suite would notice if the
 * exports we import stopped existing. That is not hypothetical: v4 dropped the
 * default export, which turned `webpush.sendNotification(...)` into a runtime
 * TypeError that tsc and every mocked test waved through. A silent push outage
 * is expensive to notice (sends just fail and subscriptions get dropped), so
 * the shape we depend on is pinned here instead.
 *
 * Nothing here touches the network: the library rejects a subscription without
 * an endpoint before it builds a request.
 */
import { describe, it, expect } from "vitest";
import { sendNotification, WebPushError } from "web-push";

describe("the web-push API we import", () => {
  it("exports sendNotification as a callable, pre-bound function", async () => {
    expect(typeof sendNotification).toBe("function");
    // Detached from the module object on purpose: v4 binds this export, and a
    // release that stopped would fail here instead of in production.
    const detached = sendNotification;
    await expect(detached({ endpoint: "", keys: { p256dh: "x", auth: "y" } })).rejects.toThrow(
      /subscription/i,
    );
  });

  it("exports WebPushError carrying the status code sendPush branches on", () => {
    // Plain object, not a DOM `Headers`: the v3 types model this as a
    // string map, one more place the published types and v4 disagree.
    const err = new WebPushError("gone", 410, {}, "", "https://push.example/x");
    expect(err).toBeInstanceOf(Error);
    // sendPush deletes a subscription on 404/410 by reading this.
    expect(err.statusCode).toBe(410);
  });
});

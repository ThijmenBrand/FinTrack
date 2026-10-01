/**
 * A plan's logo: found and stored on request, served only to people who can
 * see the plan, and reported on the plan reads the UI draws from.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { setupTestDb, type TestDb } from "@/lib/test-db";

const OWNER = "logo-owner";
const VIEWER = "logo-viewer";
const STRANGER = "logo-stranger";

let actor = OWNER;
vi.mock("@/lib/auth", () => ({
  withUser: (handler: (userId: string) => Promise<Response>) =>
    handler(actor).catch((e: unknown) => {
      if (e instanceof Response) return e;
      throw e;
    }),
}));

// The lookups reach Clearbit and Google; here they answer from memory.
const lookups = vi.hoisted(() => ({
  fromName: vi.fn(),
  fromInput: vi.fn(),
}));
vi.mock("@/lib/merchant-logo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/merchant-logo")>()),
  logoFromName: lookups.fromName,
  logoFromInput: lookups.fromInput,
}));
const scheduled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/recurring-logo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/recurring-logo")>()),
  scheduleLogoLookups: scheduled,
}));

let testDb: TestDb;
let root: string;
let png: Buffer;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "recurring-logo-"));
  process.env.FILE_STORAGE_DIR = root;
  testDb = await setupTestDb("recurring-logo-route");
  png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#5b21b6" } }).webp().toBuffer();
});
afterAll(async () => {
  await testDb.cleanup();
  delete process.env.FILE_STORAGE_DIR;
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  actor = OWNER;
  lookups.fromName.mockReset();
  lookups.fromInput.mockReset();
  scheduled.mockReset();
  await testDb.reset();
  const now = new Date().toISOString();
  for (const id of [OWNER, VIEWER, STRANGER]) {
    await testDb.client.execute({
      sql: `INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [id, id, `${id}@test.dev`, Date.now(), Date.now()],
    });
  }
  await testDb.client.execute({
    sql: `INSERT INTO accounts (id, user_id, name, type, created_at, updated_at) VALUES ('acc', ?, 'Checking', 'checking', ?, ?)`,
    args: [OWNER, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO account_members (id, account_id, user_id, email, role, created_at, accepted_at)
          VALUES ('m1', 'acc', ?, ?, 'viewer', ?, ?)`,
    args: [VIEWER, `${VIEWER}@test.dev`, now, now],
  });
  await testDb.client.execute({
    sql: `INSERT INTO recurring_transactions (id, user_id, account_id, description, amount, type, frequency, day_of_month, start_date, created_at)
          VALUES ('hbo', ?, 'acc', 'HBO Max', -4.5, 'expense', 'monthly', 1, '2026-01-01', ?)`,
    args: [OWNER, now],
  });
});

const params = (id = "hbo") => ({ params: Promise.resolve({ id }) });
const route = () => import("./route");

const setLogo = async (body: unknown = {}) =>
  (await route()).POST(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Request("http://x/api/recurring/hbo/logo", { method: "POST", body: JSON.stringify(body) }) as any,
    params(),
  );
const getLogo = async () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (await route()).GET(new Request("http://x/api/recurring/hbo/logo") as any, params());
const removeLogo = async () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (await route()).DELETE(new Request("http://x/api/recurring/hbo/logo", { method: "DELETE" }) as any, params());

const planRow = async () =>
  (
    await testDb.client.execute(
      "SELECT logo_key AS k, logo_source AS s, logo_checked_at AS c FROM recurring_transactions WHERE id = 'hbo'",
    )
  ).rows[0];

describe("POST /api/recurring/[id]/logo", () => {
  it("looks the plan's own name up when no source is given, and stores the result", async () => {
    lookups.fromName.mockResolvedValue({ bytes: png, source: "hbomax.com" });

    const res = await setLogo();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(lookups.fromName).toHaveBeenCalledWith("HBO Max");
    expect(body.logoSource).toBe("hbomax.com");
    expect(body.logoUrl).toMatch(/^\/api\/recurring\/hbo\/logo\?v=[0-9a-f]+$/);

    const row = await planRow();
    expect(row.k).toMatch(/^logos\/hbo-[0-9a-f]+\.webp$/);
    expect(row.s).toBe("hbomax.com");

    const served = await getLogo();
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/webp");
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);
  });

  it("uses what the user typed, and replaces the old file", async () => {
    lookups.fromName.mockResolvedValue({ bytes: png, source: "hbomax.com" });
    await setLogo();
    const first = (await planRow()).k as string;

    lookups.fromInput.mockResolvedValue({ bytes: png, source: "max.com" });
    const res = await setLogo({ source: "max.com" });
    expect(res.status).toBe(200);
    expect(lookups.fromInput).toHaveBeenCalledWith("max.com");
    const row = await planRow();
    expect(row.s).toBe("max.com");
    expect(row.k).not.toBe(first);

    const { readFile } = await import("@/lib/file-store");
    expect(await readFile(first)).toBeNull();
  });

  it("says so when nothing is found, and leaves the plan as it was", async () => {
    lookups.fromInput.mockResolvedValue(null);
    const res = await setLogo({ source: "nothing-here.example" });
    expect(res.status).toBe(422);
    expect((await planRow()).k).toBeNull();
  });

  it("rejects a source that isn't a string, or isn't a usable link", async () => {
    expect((await setLogo({ source: 42 })).status).toBe(400);
    expect((await setLogo({ source: "ftp://example.com/logo.png" })).status).toBe(400);
    expect((await setLogo(null)).status).not.toBe(500);
    expect(lookups.fromInput).not.toHaveBeenCalled();
  });

  it("is refused to a viewer and a stranger", async () => {
    actor = VIEWER;
    expect((await setLogo({ source: "max.com" })).status).toBe(403);
    actor = STRANGER;
    expect((await setLogo({ source: "max.com" })).status).toBe(404);
    expect(lookups.fromInput).not.toHaveBeenCalled();
  });
});

describe("GET /api/recurring/[id]/logo", () => {
  it("serves a viewer of the account, but not a stranger", async () => {
    lookups.fromName.mockResolvedValue({ bytes: png, source: "hbomax.com" });
    await setLogo();

    actor = VIEWER;
    expect((await getLogo()).status).toBe(200);
    actor = STRANGER;
    expect((await getLogo()).status).toBe(404);
  });

  it("is a 404 for a plan without a logo", async () => {
    expect((await getLogo()).status).toBe(404);
  });
});

describe("DELETE /api/recurring/[id]/logo", () => {
  it("removes the file and keeps the automatic lookup from bringing it back", async () => {
    lookups.fromName.mockResolvedValue({ bytes: png, source: "hbomax.com" });
    await setLogo();
    const key = (await planRow()).k as string;

    expect((await removeLogo()).status).toBe(200);
    const row = await planRow();
    expect(row.k).toBeNull();
    expect(row.s).toBeNull();
    expect(row.c).toEqual(expect.any(String));

    const { readFile } = await import("@/lib/file-store");
    expect(await readFile(key)).toBeNull();
  });

  it("is refused to a viewer", async () => {
    actor = VIEWER;
    expect((await removeLogo()).status).toBe(403);
  });
});

describe("plan reads", () => {
  const list = async () => (await import("../../route")).GET();

  it("report the logo URL and whether a lookup is still due", async () => {
    let [plan] = await (await list()).json();
    expect(plan).toMatchObject({ logoUrl: null, logoSource: null, logoPending: true });
    expect(plan).not.toHaveProperty("logoKey");
    expect(plan).not.toHaveProperty("userId");
    expect(scheduled).toHaveBeenCalledWith([expect.objectContaining({ id: "hbo", logoCheckedAt: null })]);

    lookups.fromName.mockResolvedValue({ bytes: png, source: "hbomax.com" });
    await setLogo();
    [plan] = await (await list()).json();
    expect(plan).toMatchObject({ logoSource: "hbomax.com", logoPending: false });
    expect(plan.logoUrl).toMatch(/^\/api\/recurring\/hbo\/logo\?v=/);
  });

  it("stop being pending once a lookup came back empty a while ago", async () => {
    await testDb.client.execute(
      "UPDATE recurring_transactions SET logo_checked_at = '2026-01-01T00:00:00.000Z' WHERE id = 'hbo'",
    );
    const [plan] = await (await list()).json();
    expect(plan.logoPending).toBe(false);
  });

  it("try again after a rename when there's no logo yet, but keep one that's there", async () => {
    const { PUT } = await import("../../route");
    const rename = (description: string) =>
      PUT(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Request("http://x/api/recurring", { method: "PUT", body: JSON.stringify({ id: "hbo", description }) }) as any,
      );

    await testDb.client.execute(
      "UPDATE recurring_transactions SET logo_checked_at = '2026-01-01T00:00:00.000Z' WHERE id = 'hbo'",
    );
    await rename("Max");
    expect((await planRow()).c).toBeNull();

    lookups.fromInput.mockResolvedValue({ bytes: png, source: "max.com" });
    await setLogo({ source: "max.com" });
    const before = await planRow();
    await rename("HBO Max");
    expect(await planRow()).toEqual(before);
  });

  it("delete the stored file along with the plan", async () => {
    lookups.fromName.mockResolvedValue({ bytes: png, source: "hbomax.com" });
    await setLogo();
    const key = (await planRow()).k as string;

    const { DELETE } = await import("../../route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await DELETE(new Request("http://x/api/recurring?id=hbo", { method: "DELETE" }) as any);

    const { readFile } = await import("@/lib/file-store");
    expect(await readFile(key)).toBeNull();
  });
});

describe("account deletion", () => {
  const deleteAccount = async () => {
    const { DELETE } = await import("../../../accounts/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return DELETE(new Request("http://x/api/accounts?id=acc", { method: "DELETE" }) as any);
  };
  const storedLogo = async () => {
    lookups.fromName.mockResolvedValue({ bytes: png, source: "hbomax.com" });
    await setLogo();
    return (await planRow()).k as string;
  };

  it("deletes the logo files of the plans that went with the account", async () => {
    const key = await storedLogo();
    // The test schema declares no foreign keys, so the cascade is played by hand.
    const { discardLogosAfter } = await import("@/lib/recurring-logo");
    await discardLogosAfter({ userId: OWNER, accountId: "acc" }, async () => {
      await testDb.client.execute("DELETE FROM recurring_transactions WHERE account_id = 'acc'");
      await testDb.client.execute("DELETE FROM accounts WHERE id = 'acc'");
    });

    const { readFile } = await import("@/lib/file-store");
    expect(await readFile(key)).toBeNull();
  });

  it("keeps the file of a plan the cascade didn't reach", async () => {
    const key = await storedLogo();
    expect((await deleteAccount()).status).toBe(200);
    expect(await testDb.client.execute("SELECT 1 FROM accounts WHERE id = 'acc'")).toMatchObject({ rows: [] });

    expect((await planRow()).k).toBe(key);
    const { readFile } = await import("@/lib/file-store");
    expect(await readFile(key)).not.toBeNull();
  });
});

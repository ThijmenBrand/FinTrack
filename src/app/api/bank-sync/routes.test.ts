import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { setupTestDb, type TestDb } from "@/lib/test-db";

// The web half of bank sync: who may do what, in which session. The worker is
// not involved — these routes only ever enqueue.

const A = "routes-user-a";
const B = "routes-user-b";
const SESSION = "session-a1";
let caller = { userId: A, sessionId: SESSION };

vi.mock("@/lib/auth", () => {
  const run = async (handler: (v: unknown) => Promise<Response>, v: unknown) => {
    try {
      return await handler(v);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
  };
  return {
    withUser: (handler: (id: string) => Promise<Response>) => run(handler as never, caller.userId),
    withSession: (handler: (ids: unknown) => Promise<Response>) => run(handler, { ...caller }),
    withAdminSession: (handler: (ids: unknown) => Promise<Response>) => run(handler, { ...caller }),
  };
});

let testDb: TestDb;
const exec = (sql: string, args: (string | number | null)[] = []) => testDb.client.execute({ sql, args });
const rows = async (sql: string, args: (string | number | null)[] = []) =>
  (await exec(sql, args)).rows as unknown as Record<string, unknown>[];
const now = () => new Date().toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

beforeAll(async () => {
  testDb = await setupTestDb("bank-sync-routes");
});
afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.reset();
  caller = { userId: A, sessionId: SESSION };
  for (const id of [A, B]) {
    await exec(`INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, [
      id, id, `${id}@local.test`, Date.now(), Date.now(),
    ]);
  }
  for (const [id, user] of [["acc-a", A], ["acc-b", B]]) {
    await exec(
      `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, internal_transfers, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'checking', 'EUR', 0, 1, 0, ?, ?)`,
      [id, user, id, now(), now()],
    );
  }
  await exec(
    `INSERT INTO bank_credentials (id, user_id, app_id, certificate_pem, certificate_fingerprint, certificate_not_after, private_key_enc, status, created_at, updated_at)
     VALUES ('cred-a', ?, '11111111-2222-3333-4444-555555555555', 'pem', 'fp', ?, 'v1:x', 'verified', ?, ?)`,
    [A, later(86_400_000), now(), now()],
  );
});

function req(url: string, init: RequestInit = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Request(`http://x${url}`, { headers: { "content-type": "application/json" }, ...init }) as any;
}

async function grantStepUp(sessionId = SESSION, userId = A) {
  await exec(
    `INSERT INTO step_up_grants (id, user_id, session_id, method, expires_at, created_at) VALUES (?, ?, ?, 'totp', ?, ?)`,
    [crypto.randomUUID(), userId, sessionId, later(60_000), now()],
  );
}

async function authState(o: { raw: string; userId?: string; sessionId?: string; expiresAt?: string; usedAt?: string | null; connectionId?: string | null; completedAt?: string | null }) {
  const id = crypto.randomUUID();
  await exec(
    `INSERT INTO bank_auth_states (id, user_id, session_id, state_hash, purpose, aspsp_name, aspsp_country, connection_id, expires_at, used_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, 'connect', 'Mock Bank', 'NL', ?, ?, ?, ?, ?)`,
    [id, o.userId ?? A, o.sessionId ?? SESSION, sha(o.raw), o.connectionId ?? null, o.expiresAt ?? later(600_000), o.usedAt ?? null, o.completedAt ?? null, now()],
  );
  return id;
}

const RAW = "s".repeat(43);

describe("step-up gating", () => {
  it("refuses a sensitive action without a fresh confirmation in this session", async () => {
    const { DELETE } = await import("./credentials/route");
    const res = await DELETE(req("/api/bank-sync/credentials", { method: "DELETE" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_required");
    expect(await rows("SELECT * FROM jobs")).toHaveLength(0);
  });

  it("a grant from another session doesn't count", async () => {
    await grantStepUp("some-other-session");
    const { DELETE } = await import("./credentials/route");
    const res = await DELETE(req("/api/bank-sync/credentials", { method: "DELETE" }));
    expect(res.status).toBe(403);
  });

  it("an expired grant doesn't count", async () => {
    await exec(
      `INSERT INTO step_up_grants (id, user_id, session_id, method, expires_at, created_at) VALUES ('old', ?, ?, 'totp', ?, ?)`,
      [A, SESSION, new Date(Date.now() - 1000).toISOString(), now()],
    );
    const { DELETE } = await import("./credentials/route");
    expect((await DELETE(req("/api/bank-sync/credentials", { method: "DELETE" }))).status).toBe(403);
  });

  it("with a fresh grant the action is queued", async () => {
    await grantStepUp();
    const { DELETE } = await import("./credentials/route");
    const res = await DELETE(req("/api/bank-sync/credentials", { method: "DELETE" }));
    expect(res.status).toBe(202);
    expect(await rows("SELECT type, user_id FROM jobs")).toEqual([{ type: "bank.delete_credential", user_id: A }]);
  });

  it("starting a connection binds the trip to this session", async () => {
    await grantStepUp();
    const { POST } = await import("./connections/route");
    const res = await POST(req("/api/bank-sync/connections", { method: "POST", body: JSON.stringify({ aspspName: "Mock Bank", aspspCountry: "NL" }) }));
    expect(res.status).toBe(202);
    const [job] = await rows("SELECT payload FROM jobs");
    expect(JSON.parse(job.payload as string)).toMatchObject({ sessionId: SESSION, purpose: "connect" });
  });

  it("rejects a country outside the allowlist", async () => {
    await grantStepUp();
    const { POST } = await import("./connections/route");
    const res = await POST(req("/api/bank-sync/connections", { method: "POST", body: JSON.stringify({ aspspName: "X", aspspCountry: "US" }) }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/bank-sync/callback", () => {
  async function callback(body: Record<string, unknown>) {
    const { POST } = await import("./callback/route");
    return POST(req("/api/bank-sync/callback", { method: "POST", body: JSON.stringify(body) }));
  }

  it("consumes a valid state once and queues the code exchange", async () => {
    const id = await authState({ raw: RAW });
    const res = await callback({ state: RAW, code: "the-code" });
    expect(res.status).toBe(202);
    const [state] = await rows("SELECT used_at FROM bank_auth_states WHERE id = ?", [id]);
    expect(state.used_at).toBeTruthy();
    const [job] = await rows("SELECT type, payload FROM jobs");
    expect(job.type).toBe("bank.complete_auth");
    expect(JSON.parse(job.payload as string)).toEqual({ authStateId: id, code: "the-code" });

    // Replay: refused.
    expect((await callback({ state: RAW, code: "the-code" })).status).toBe(400);
    expect(await rows("SELECT * FROM jobs")).toHaveLength(1);
  });

  it("refuses a state from another session", async () => {
    await authState({ raw: RAW, sessionId: "another-session" });
    expect((await callback({ state: RAW, code: "c" })).status).toBe(400);
    expect(await rows("SELECT * FROM jobs")).toHaveLength(0);
  });

  it("refuses another user's state (login-CSRF style)", async () => {
    await authState({ raw: RAW, userId: B, sessionId: SESSION });
    expect((await callback({ state: RAW, code: "c" })).status).toBe(400);
  });

  it("refuses an expired state", async () => {
    await authState({ raw: RAW, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await callback({ state: RAW, code: "c" })).status).toBe(400);
  });

  it("closes the trip when the bank reports an error", async () => {
    const id = await authState({ raw: RAW });
    expect((await callback({ state: RAW, error: "access_denied" })).status).toBe(400);
    const [state] = await rows("SELECT completed_at FROM bank_auth_states WHERE id = ?", [id]);
    expect(state.completed_at).toBeTruthy();
    expect(await rows("SELECT * FROM jobs")).toHaveLength(0);
  });

  it("refuses malformed input", async () => {
    expect((await callback({ state: "short", code: "c" })).status).toBe(400);
    expect((await callback({ state: RAW, code: "x".repeat(3000) })).status).toBe(400);
  });
});

describe("POST /api/bank-sync/links", () => {
  async function connection() {
    await exec(
      `INSERT INTO bank_connections (id, user_id, credential_id, aspsp_name, aspsp_country, session_id_enc, status, available_accounts, created_at, updated_at)
       VALUES ('conn-a', ?, 'cred-a', 'Mock Bank', 'NL', 'v1:x', 'active', ?, ?, ?)`,
      [A, JSON.stringify([{ uid: "uid-1", iban: "NL01BANK0000000001", name: "Checking", currency: "EUR" }]), now(), now()],
    );
    return authState({ raw: RAW, usedAt: now(), connectionId: "conn-a" });
  }

  async function link(body: Record<string, unknown>) {
    const { POST } = await import("./links/route");
    return POST(req("/api/bank-sync/links", { method: "POST", body: JSON.stringify(body) }));
  }

  it("links an own account and queues its first sync, once", async () => {
    const authStateId = await connection();
    const res = await link({ authStateId, links: [{ uid: "uid-1", accountId: "acc-a", syncFrom: "2026-09-01" }] });
    expect(res.status).toBe(201);
    expect(await rows("SELECT account_id, external_uid, sync_from FROM bank_account_links")).toEqual([
      { account_id: "acc-a", external_uid: "uid-1", sync_from: "2026-09-01" },
    ]);
    expect((await rows("SELECT type FROM jobs"))[0].type).toBe("bank.sync_link");
    // The trip is spent.
    expect((await link({ authStateId, links: [{ uid: "uid-1", accountId: "acc-a", syncFrom: "2026-09-01" }] })).status).toBe(400);
  });

  it("can create the account it feeds", async () => {
    const authStateId = await connection();
    const res = await link({ authStateId, links: [{ uid: "uid-1", newAccount: { name: "ING Checking", type: "checking" }, syncFrom: "2026-09-01" }] });
    expect(res.status).toBe(201);
    const [acc] = await rows("SELECT * FROM accounts WHERE name = 'ING Checking'");
    expect(acc).toMatchObject({ user_id: A, iban: "NL01BANK0000000001", bank_name: "Mock Bank" });
  });

  it("won't link another user's account", async () => {
    const authStateId = await connection();
    const res = await link({ authStateId, links: [{ uid: "uid-1", accountId: "acc-b", syncFrom: "2026-09-01" }] });
    expect(res.status).toBe(400);
    expect(await rows("SELECT * FROM bank_account_links")).toHaveLength(0);
  });

  it("won't accept a bank account the consent doesn't cover", async () => {
    const authStateId = await connection();
    const res = await link({ authStateId, links: [{ uid: "uid-other", accountId: "acc-a", syncFrom: "2026-09-01" }] });
    expect(res.status).toBe(400);
  });

  it("is closed to other sessions", async () => {
    const authStateId = await connection();
    caller = { userId: A, sessionId: "another-session" };
    const res = await link({ authStateId, links: [{ uid: "uid-1", accountId: "acc-a", syncFrom: "2026-09-01" }] });
    expect(res.status).toBe(400);
  });

  it("refuses a start date in the future", async () => {
    const authStateId = await connection();
    const res = await link({ authStateId, links: [{ uid: "uid-1", accountId: "acc-a", syncFrom: "2999-01-01" }] });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/bank-sync/requests/:id", () => {
  it("answers 404 for another user's job", async () => {
    await exec(
      `INSERT INTO jobs (id, user_id, type, payload, priority, status, run_at, attempts, max_attempts, created_at, updated_at)
       VALUES ('job-b', ?, 'bank.list_aspsps', '{}', 0, 'succeeded', ?, 1, 5, ?, ?)`,
      [B, now(), now(), now()],
    );
    const { GET } = await import("./requests/[id]/route");
    const res = await GET(req("/api/bank-sync/requests/job-b"), { params: Promise.resolve({ id: "job-b" }) });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/bank-sync/status", () => {
  it("never exposes the key, the session id or the state", async () => {
    await exec(
      `INSERT INTO bank_connections (id, user_id, credential_id, aspsp_name, aspsp_country, session_id_enc, status, available_accounts, created_at, updated_at)
       VALUES ('conn-a', ?, 'cred-a', 'Mock Bank', 'NL', 'v1:SESSIONSECRET', 'active', '[]', ?, ?)`,
      [A, now(), now()],
    );
    await exec("UPDATE bank_credentials SET private_key_enc = 'v1:KEYSECRET' WHERE id = 'cred-a'");
    const { GET } = await import("./status/route");
    const text = await (await GET()).text();
    expect(text).not.toContain("KEYSECRET");
    expect(text).not.toContain("SESSIONSECRET");
    expect(JSON.parse(text).connections).toHaveLength(1);
  });
});

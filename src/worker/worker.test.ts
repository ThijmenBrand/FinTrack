import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { setupTestDb, type TestDb } from "@/lib/test-db";
import { enqueueJob } from "@/lib/jobs/enqueue";
import { bankSyncRedirectUrl } from "@/lib/bank-sync/config";
import { enqueueDueSyncs, reapExpiredLeases } from "@/db/jobs";
import { setKeyRingForTests } from "./crypto/kek";
import { setFetchForTests } from "./bank-sync/context";
import { runOnce, type RunnerHooks } from "./runner";
import { rotateKek } from "./rotate-kek";
import { aadFor, open } from "./crypto/secret-box";

// End-to-end through the queue: enqueue like the web app does, run like the
// worker does, with Enable Banking replaced by an in-memory fake.

const A = "worker-user-a";
const B = "worker-user-b";
let testDb: TestDb;

const exec = (sql: string, args: (string | number | null)[] = []) => testDb.client.execute({ sql, args });
const rows = async (sql: string, args: (string | number | null)[] = []) =>
  (await exec(sql, args)).rows as unknown as Record<string, unknown>[];
const now = () => new Date().toISOString();

// ─── Fake Enable Banking ─────────────────────────────────────────────────

interface FakeBank {
  application: Record<string, unknown>;
  transactions: Record<string, Array<{ body: Record<string, unknown>; status?: number }>>;
  balances: Record<string, unknown>;
  failNext: { status: number; body?: Record<string, unknown>; headers?: Record<string, string> } | null;
  lastAuthBody: Record<string, unknown> | null;
  requests: Array<{ method: string; path: string; auth: string | null; psuIp: string | null }>;
  sessionAccounts: Array<Record<string, unknown>>;
}

let bank: FakeBank;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

async function fakeFetch(input: string, init: RequestInit): Promise<Response> {
  const url = new URL(input);
  const headers = new Headers(init.headers);
  bank.requests.push({
    method: init.method ?? "GET",
    path: url.pathname,
    auth: headers.get("authorization"),
    psuIp: headers.get("psu-ip-address"),
  });
  expect(url.origin).toBe("https://api.enablebanking.com");
  expect(init.redirect).toBe("error");
  if (bank.failNext) {
    const f = bank.failNext;
    bank.failNext = null;
    return json(f.status, f.body ?? {}, f.headers);
  }
  if (url.pathname === "/application") return json(200, bank.application);
  if (url.pathname === "/aspsps") {
    return json(200, { aspsps: [{ name: "Mock Bank", country: "NL", psu_types: ["personal"], maximum_consent_validity: 90 * 86400 }] });
  }
  if (url.pathname === "/auth") {
    bank.lastAuthBody = JSON.parse(String(init.body));
    return json(200, { url: "https://bank.example/authorize?x=1" });
  }
  if (url.pathname === "/sessions" && init.method === "POST") {
    return json(200, {
      session_id: "sess-1",
      access: { valid_until: "2027-03-01T00:00:00Z" },
      accounts: bank.sessionAccounts,
    });
  }
  if (url.pathname.startsWith("/sessions/") && init.method === "DELETE") return json(200, { message: "ok" });
  const tx = /^\/accounts\/([^/]+)\/transactions$/.exec(url.pathname);
  if (tx) {
    const pages = bank.transactions[tx[1]] ?? [{ body: { transactions: [] } }];
    const key = url.searchParams.get("continuation_key");
    const index = key ? Number(key) : 0;
    const page = pages[index];
    return json(page.status ?? 200, page.body);
  }
  const bal = /^\/accounts\/([^/]+)\/balances$/.exec(url.pathname);
  if (bal) return json(200, bank.balances[bal[1]] ?? { balances: [] });
  return json(404, { error: "NOT_FOUND" });
}

function ebTx(o: {
  ref?: string;
  amount: string;
  cd: "CRDT" | "DBIT";
  date: string;
  name?: string;
  iban?: string;
  text?: string;
  balance?: string;
}) {
  const party = { name: o.name ?? "Someone" };
  const account = o.iban ? { iban: o.iban } : undefined;
  return {
    entry_reference: o.ref,
    transaction_amount: { amount: o.amount, currency: "EUR" },
    credit_debit_indicator: o.cd,
    status: "BOOK",
    booking_date: o.date,
    ...(o.cd === "DBIT" ? { creditor: party, creditor_account: account } : { debtor: party, debtor_account: account }),
    remittance_information: [o.text ?? "Payment"],
    ...(o.balance ? { balance_after_transaction: { amount: o.balance, currency: "EUR" } } : {}),
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────

const KEY_V1 = randomBytes(32);

beforeAll(async () => {
  testDb = await setupTestDb("worker");
  setFetchForTests(fakeFetch);
});
afterAll(async () => {
  setFetchForTests(undefined);
  setKeyRingForTests(null);
  await testDb.cleanup();
});

beforeEach(async () => {
  await testDb.reset();
  setKeyRingForTests({ current: { version: 1, key: KEY_V1 }, previous: new Map() });
  bank = {
    application: { environment: "PRODUCTION", redirect_urls: [bankSyncRedirectUrl()], active: true },
    transactions: {},
    balances: {},
    failNext: null,
    lastAuthBody: null,
    requests: [],
    sessionAccounts: [
      { uid: "uid-check", account_id: { iban: "NL01BANK0000000001" }, name: "Checking", currency: "EUR" },
      { uid: "uid-save", account_id: { iban: "NL01BANK0000000002" }, name: "Savings", currency: "EUR" },
    ],
  };
  for (const id of [A, B]) {
    // @local.test addresses are never mailed (see sendEmail).
    await exec(`INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, [
      id, id, `${id}@local.test`, Date.now(), Date.now(),
    ]);
  }
  for (const [id, user, iban] of [
    ["acc-check", A, "NL01BANK0000000001"],
    ["acc-save", A, "NL01BANK0000000002"],
    ["acc-b", B, "NL01BANK0000000009"],
  ]) {
    await exec(
      `INSERT INTO accounts (id, user_id, name, type, iban, currency, initial_balance, internal_transfers, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'checking', ?, 'EUR', 0, 1, 0, ?, ?)`,
      [id, user, id, iban, now(), now()],
    );
  }
  await exec(
    `INSERT INTO categories (id, user_id, name, kind, created_at) VALUES
     ('cat-groceries', ?, 'Groceries', 'expense', ?), ('cat-transfer', ?, 'Internal Transfer', 'transfer', ?)`,
    [A, now(), A, now()],
  );
  await exec(
    `INSERT INTO category_rules (id, user_id, pattern, category_id, match_type, match_field, is_active, created_at)
     VALUES ('rule-ah', ?, 'albert heijn', 'cat-groceries', 'contains', 'both', 1, ?)`,
    [A, now()],
  );
});

const WORKER = "test-worker";

/** Run every due job (all priorities) to completion. */
async function drain(hooks?: RunnerHooks) {
  let guard = 0;
  while (await runOnce(WORKER, { hooks })) {
    if (++guard > 50) throw new Error("queue does not drain");
  }
}

async function job(id: string) {
  return (await rows("SELECT * FROM jobs WHERE id = ?", [id]))[0];
}

/** A verified credential + an active connection + links, the way the flow builds them. */
async function connectedUser(userId = A) {
  await drain(); // nothing pending
  await enqueueJob(userId, "bank.generate_credential", {});
  await drain();
  const [cred] = await rows("SELECT * FROM bank_credentials WHERE user_id = ?", [userId]);
  await exec("UPDATE bank_credentials SET app_id = ? WHERE id = ?", ["11111111-2222-3333-4444-555555555555", cred.id as string]);
  await enqueueJob(userId, "bank.verify_credential", { credentialId: cred.id as string });
  await drain();

  const startId = await enqueueJob(userId, "bank.start_auth", {
    sessionId: "session-1",
    purpose: "connect",
    aspspName: "Mock Bank",
    aspspCountry: "NL",
  });
  await drain();
  expect((await job(startId)).status).toBe("succeeded");
  const state = String(bank.lastAuthBody!.state);
  const [authState] = await rows("SELECT * FROM bank_auth_states WHERE user_id = ?", [userId]);
  // What the callback route does: consume the state.
  await exec("UPDATE bank_auth_states SET used_at = ? WHERE id = ?", [now(), authState.id as string]);
  const completeId = await enqueueJob(userId, "bank.complete_auth", { authStateId: authState.id as string, code: "the-code" });
  await drain();
  const completed = await job(completeId);
  expect(completed.status).toBe("succeeded");
  const { connectionId } = JSON.parse(completed.result as string);
  return { credentialId: cred.id as string, connectionId: connectionId as string, state, authStateId: authState.id as string };
}

async function link(connectionId: string, accountId: string, uid: string, syncFrom = "2026-09-01", userId = A) {
  const id = `link-${accountId}`;
  await exec(
    `INSERT INTO bank_account_links (id, user_id, account_id, connection_id, external_uid, iban, sync_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [id, userId, accountId, connectionId, uid, syncFrom, now(), now()],
  );
  return id;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("credentials", () => {
  it("generates a key whose private half is only stored sealed", async () => {
    const id = await enqueueJob(A, "bank.generate_credential", {});
    await drain();
    expect((await job(id)).status).toBe("succeeded");
    const [cred] = await rows("SELECT * FROM bank_credentials WHERE user_id = ?", [A]);
    expect(cred.certificate_pem).toMatch(/BEGIN CERTIFICATE/);
    expect(cred.private_key_enc).toMatch(/^v1:/);
    expect(String(cred.private_key_enc)).not.toContain("PRIVATE KEY");
    expect(cred.status).toBe("pending_app_id");
    // The payload is wiped once the job is done.
    expect((await job(id)).payload).toBe("{}");
  }, 60_000);

  it("verifies an application and signs with the user's own key", async () => {
    await connectedUser();
    const [cred] = await rows("SELECT status, last_error_code FROM bank_credentials WHERE user_id = ?", [A]);
    expect(cred).toMatchObject({ status: "verified", last_error_code: null });
    const auth = bank.requests.find((r) => r.path === "/application")!.auth!;
    const header = JSON.parse(Buffer.from(auth.split(" ")[1].split(".")[0], "base64url").toString());
    expect(header).toMatchObject({ alg: "RS256", kid: "11111111-2222-3333-4444-555555555555" });
  }, 60_000);

  it("reports a missing redirect URL as something the user must fix, not a dead job", async () => {
    bank.application = { environment: "PRODUCTION", redirect_urls: ["https://elsewhere.example/cb"], active: true };
    await enqueueJob(A, "bank.generate_credential", {});
    await drain();
    const [cred] = await rows("SELECT * FROM bank_credentials WHERE user_id = ?", [A]);
    await exec("UPDATE bank_credentials SET app_id = 'x' WHERE id = ?", [cred.id as string]);
    const id = await enqueueJob(A, "bank.verify_credential", { credentialId: cred.id as string });
    await drain();
    expect(await job(id)).toMatchObject({ status: "failed", last_error_code: "redirect_url_missing" });
    expect((await rows("SELECT status, last_error_code FROM bank_credentials"))[0]).toMatchObject({
      status: "invalid",
      last_error_code: "redirect_url_missing",
    });
  }, 60_000);

  it("refuses a sandbox application in production mode", async () => {
    bank.application = { environment: "SANDBOX", redirect_urls: [bankSyncRedirectUrl()], active: true };
    await enqueueJob(A, "bank.generate_credential", {});
    await drain();
    const [cred] = await rows("SELECT * FROM bank_credentials WHERE user_id = ?", [A]);
    await exec("UPDATE bank_credentials SET app_id = 'x' WHERE id = ?", [cred.id as string]);
    const id = await enqueueJob(A, "bank.verify_credential", { credentialId: cred.id as string });
    await drain();
    expect(await job(id)).toMatchObject({ status: "failed", last_error_code: "wrong_environment" });
  }, 60_000);
});

describe("connecting", () => {
  it("stores only the hash of the state and seals the session id", async () => {
    const { state, connectionId } = await connectedUser();
    const [authState] = await rows("SELECT * FROM bank_auth_states");
    expect(authState.state_hash).toBe(createHash("sha256").update(state).digest("hex"));
    expect(JSON.stringify(await rows("SELECT * FROM bank_auth_states"))).not.toContain(state);
    expect(authState.connection_id).toBe(connectionId);
    expect(bank.lastAuthBody).toMatchObject({
      redirect_url: bankSyncRedirectUrl(),
      psu_type: "personal",
      aspsp: { name: "Mock Bank", country: "NL" },
    });

    const [connection] = await rows("SELECT * FROM bank_connections WHERE id = ?", [connectionId]);
    expect(connection.session_id_enc).toMatch(/^v1:/);
    expect(String(connection.session_id_enc)).not.toContain("sess-1");
    expect(JSON.parse(connection.available_accounts as string)).toHaveLength(2);
  }, 60_000);

  it("refuses to exchange a code twice", async () => {
    const { authStateId } = await connectedUser();
    await exec("UPDATE bank_auth_states SET completed_at = ? WHERE id = ?", [now(), authStateId]);
    const id = await enqueueJob(A, "bank.complete_auth", { authStateId, code: "again" });
    await drain();
    expect(await job(id)).toMatchObject({ status: "failed", last_error_code: "auth_state_invalid" });
  }, 60_000);

  it("won't complete another user's authorisation", async () => {
    const { authStateId } = await connectedUser(A);
    await exec("UPDATE bank_auth_states SET completed_at = NULL WHERE id = ?", [authStateId]);
    const id = await enqueueJob(B, "bank.complete_auth", { authStateId, code: "stolen" });
    await drain();
    expect(await job(id)).toMatchObject({ status: "failed", last_error_code: "auth_state_invalid" });
    expect(await rows("SELECT * FROM bank_connections WHERE user_id = ?", [B])).toHaveLength(0);
  }, 60_000);

  it("disconnecting revokes at the bank and keeps the transactions", async () => {
    const { connectionId } = await connectedUser();
    await link(connectionId, "acc-check", "uid-check");
    await exec(
      `INSERT INTO transactions (id, user_id, account_id, date, description, amount, type, external_id, created_at)
       VALUES ('kept', ?, 'acc-check', '2026-09-02', 'x', -1, 'expense', 'ref:1', ?)`,
      [A, now()],
    );
    await enqueueJob(A, "bank.revoke_session", { connectionId });
    await drain();
    expect(bank.requests.some((r) => r.method === "DELETE" && r.path === "/sessions/sess-1")).toBe(true);
    expect(await rows("SELECT * FROM bank_connections")).toHaveLength(0);
    expect(await rows("SELECT * FROM bank_account_links")).toHaveLength(0);
    expect(await rows("SELECT * FROM transactions WHERE id = 'kept'")).toHaveLength(1);
  }, 60_000);
});

describe("syncing", () => {
  it("imports booked rows across pages, classifies them and moves the cursor", async () => {
    const { connectionId } = await connectedUser();
    const linkId = await link(connectionId, "acc-check", "uid-check");
    bank.transactions["uid-check"] = [
      {
        body: {
          transactions: [
            ebTx({ ref: "r1", amount: "25.50", cd: "DBIT", date: "2026-09-03", name: "Albert Heijn", text: "AH 1234", balance: "974.50" }),
            ebTx({ ref: "old", amount: "5.00", cd: "DBIT", date: "2026-08-20", text: "before the start" }),
          ],
          continuation_key: "1",
        },
      },
      // An empty page that still carries a key must not end the paging.
      { body: { transactions: [], continuation_key: "2" } },
      {
        body: {
          transactions: [
            ebTx({ ref: "r2", amount: "1500.00", cd: "CRDT", date: "2026-09-05", name: "Employer", text: "Salary", balance: "2474.50" }),
            { ...ebTx({ ref: "p1", amount: "3.00", cd: "DBIT", date: "2026-09-06" }), status: "PDNG" },
          ],
        },
      },
    ];
    bank.balances["uid-check"] = { balances: [{ name: "x", balance_amount: { amount: "2474.50", currency: "EUR" }, balance_type: "CLBD" }] };

    await enqueueJob(A, "bank.sync_link", { linkId });
    await drain();

    const txs = await rows("SELECT * FROM transactions WHERE account_id = 'acc-check' ORDER BY date");
    expect(txs.map((t) => [t.date, t.amount, t.external_id, t.category_id])).toEqual([
      ["2026-09-03", -25.5, "ref:r1", "cat-groceries"],
      ["2026-09-05", 1500, "ref:r2", null],
    ]);
    expect(txs[0]).toMatchObject({ name: "Albert Heijn", description: "AH 1234", balance: 974.5, created_by: A });
    const [l] = await rows("SELECT * FROM bank_account_links WHERE id = ?", [linkId]);
    expect(l).toMatchObject({ last_booked_date: "2026-09-05", bank_balance: 2474.5, last_error_code: null });
    expect(l.last_synced_at).toBeTruthy();
    const [batch] = await rows("SELECT * FROM import_batches");
    expect(batch).toMatchObject({ source: "bank_sync", file_name: "Bank sync · Mock Bank", transaction_count: 2 });
  }, 60_000);

  it("is idempotent: running the same sync again adds nothing", async () => {
    const { connectionId } = await connectedUser();
    const linkId = await link(connectionId, "acc-check", "uid-check");
    bank.transactions["uid-check"] = [
      {
        body: {
          transactions: [
            ebTx({ ref: "r1", amount: "10.00", cd: "DBIT", date: "2026-09-03" }),
            // Two identical coffees without a reference: both must survive.
            ebTx({ amount: "3.00", cd: "DBIT", date: "2026-09-04", name: "Coffee", text: "Coffee" }),
            ebTx({ amount: "3.00", cd: "DBIT", date: "2026-09-04", name: "Coffee", text: "Coffee" }),
          ],
        },
      },
    ];
    await enqueueJob(A, "bank.sync_link", { linkId });
    await drain();
    await enqueueJob(A, "bank.sync_link", { linkId });
    await drain();
    const txs = await rows("SELECT amount, external_id FROM transactions ORDER BY external_id");
    expect(txs).toHaveLength(3);
    const total = txs.reduce((s, t) => s + Number(t.amount), 0);
    expect(total).toBe(-16);
  }, 60_000);

  it("pairs a transfer between two synced accounts instead of double-counting", async () => {
    const { connectionId } = await connectedUser();
    const checkLink = await link(connectionId, "acc-check", "uid-check");
    const saveLink = await link(connectionId, "acc-save", "uid-save");
    bank.transactions["uid-check"] = [
      { body: { transactions: [ebTx({ ref: "c1", amount: "200.00", cd: "DBIT", date: "2026-09-10", iban: "NL01BANK0000000002", text: "To savings" })] } },
    ];
    bank.transactions["uid-save"] = [
      { body: { transactions: [ebTx({ ref: "s1", amount: "200.00", cd: "CRDT", date: "2026-09-10", iban: "NL01BANK0000000001", text: "From checking" })] } },
    ];
    await enqueueJob(A, "bank.sync_link", { linkId: checkLink });
    await drain();
    await enqueueJob(A, "bank.sync_link", { linkId: saveLink });
    await drain();

    const save = await rows("SELECT * FROM transactions WHERE account_id = 'acc-save'");
    expect(save).toHaveLength(1);
    expect(save[0]).toMatchObject({ type: "internal_transfer", is_mirror: 0, external_id: "ref:s1", amount: 200 });
    const check = await rows("SELECT * FROM transactions WHERE account_id = 'acc-check'");
    expect(check[0]).toMatchObject({ type: "internal_transfer", linked_transaction_id: save[0].id });
  }, 60_000);

  it("an expired consent pauses the connection and asks the user, not the DLQ", async () => {
    const { connectionId } = await connectedUser();
    const linkId = await link(connectionId, "acc-check", "uid-check");
    bank.failNext = { status: 400, body: { error: "EXPIRED_SESSION" } };
    const id = await enqueueJob(A, "bank.sync_link", { linkId });
    const dead: string[] = [];
    await drain({ onDead: (j) => dead.push(j.id) });
    expect(await job(id)).toMatchObject({ status: "failed", last_error_code: "consent_expired" });
    expect(dead).toEqual([]);
    expect((await rows("SELECT status FROM bank_connections"))[0].status).toBe("expired");
    expect((await rows("SELECT last_error_code FROM bank_account_links"))[0].last_error_code).toBe("consent_expired");
  }, 60_000);

  it("retries a provider outage with backoff and dead-letters after the last attempt", async () => {
    const { connectionId } = await connectedUser();
    const linkId = await link(connectionId, "acc-check", "uid-check");
    bank.failNext = { status: 503 };
    const id = await enqueueJob(A, "bank.sync_link", { linkId }, { maxAttempts: 2 });
    await drain();
    let j = await job(id);
    expect(j).toMatchObject({ status: "queued", attempts: 1, last_error_code: "provider_unavailable" });
    expect(Date.parse(j.run_at as string)).toBeGreaterThan(Date.now() + 30_000);
    // The payload is kept for the retry.
    expect(JSON.parse(j.payload as string)).toEqual({ linkId });

    await exec("UPDATE jobs SET run_at = ? WHERE id = ?", [now(), id]);
    bank.failNext = { status: 503 };
    const dead: string[] = [];
    await drain({ onDead: (dj) => dead.push(dj.id) });
    j = await job(id);
    expect(j).toMatchObject({ status: "dead", attempts: 2 });
    expect(dead).toEqual([id]);
  }, 60_000);

  it("a rate limit reschedules without using up an attempt", async () => {
    const { connectionId } = await connectedUser();
    const linkId = await link(connectionId, "acc-check", "uid-check");
    bank.failNext = { status: 429, headers: { "retry-after": "3600" } };
    const id = await enqueueJob(A, "bank.sync_link", { linkId });
    await drain();
    const j = await job(id);
    expect(j).toMatchObject({ status: "queued", attempts: 0, last_error_code: "rate_limited" });
    expect(Date.parse(j.run_at as string)).toBeGreaterThan(Date.now() + 3_500_000);
  }, 60_000);

  it("passes PSU headers on an attended sync", async () => {
    const { connectionId } = await connectedUser();
    const linkId = await link(connectionId, "acc-check", "uid-check");
    await enqueueJob(A, "bank.sync_link", { linkId, psu: { ip: "203.0.113.7", userAgent: "Test" } });
    await drain();
    expect(bank.requests.find((r) => r.path.endsWith("/transactions"))!.psuIp).toBe("203.0.113.7");
    // …and doesn't keep them.
    expect((await rows("SELECT payload FROM jobs WHERE type = 'bank.sync_link'"))[0].payload).toBe("{}");
  }, 60_000);

  it("a job can't reach another user's link", async () => {
    const { connectionId } = await connectedUser(A);
    const linkId = await link(connectionId, "acc-check", "uid-check");
    bank.transactions["uid-check"] = [{ body: { transactions: [ebTx({ ref: "r1", amount: "1.00", cd: "DBIT", date: "2026-09-03" })] } }];
    const id = await enqueueJob(B, "bank.sync_link", { linkId });
    await drain();
    expect(JSON.parse((await job(id)).result as string)).toEqual({ skipped: "link_gone" });
    expect(await rows("SELECT * FROM transactions")).toHaveLength(0);
    expect(bank.requests.some((r) => r.path.includes("/accounts/"))).toBe(false);
  }, 60_000);
});

describe("queue housekeeping", () => {
  it("hands an abandoned job back to the queue", async () => {
    await exec(
      `INSERT INTO jobs (id, user_id, type, payload, priority, status, run_at, attempts, max_attempts, locked_by, locked_until, created_at, updated_at)
       VALUES ('stuck', ?, 'bank.list_aspsps', '{"country":"NL"}', 0, 'running', ?, 1, 5, 'gone-worker', ?, ?, ?)`,
      [A, now(), new Date(Date.now() - 1000).toISOString(), now(), now()],
    );
    expect(await reapExpiredLeases()).toBe(1);
    expect(await job("stuck")).toMatchObject({ status: "queued", locked_by: null, last_error_code: "lease_expired" });
  });

  it("queues each due link once, however often the scheduler runs", async () => {
    const { connectionId } = await connectedUser();
    await link(connectionId, "acc-check", "uid-check");
    expect(await enqueueDueSyncs(6 * 3_600_000)).toBe(1);
    expect(await enqueueDueSyncs(6 * 3_600_000)).toBe(0);
    expect(await rows("SELECT * FROM jobs WHERE type = 'bank.sync_link' AND status = 'queued'")).toHaveLength(1);
  }, 60_000);
});

describe("master key rotation", () => {
  it("re-seals keys and sessions under the new master key", async () => {
    const { connectionId } = await connectedUser();
    const keyV2 = randomBytes(32);
    const ring = { current: { version: 2, key: keyV2 }, previous: new Map([[1, KEY_V1]]) };
    expect(await rotateKek(ring)).toEqual({ resealed: 2, failed: 0 });

    // Readable with the new key alone, the old one is no longer needed.
    const onlyV2 = { current: { version: 2, key: keyV2 }, previous: new Map<number, Buffer>() };
    const [cred] = await rows("SELECT * FROM bank_credentials");
    const [conn] = await rows("SELECT * FROM bank_connections WHERE id = ?", [connectionId]);
    expect(cred.private_key_enc).toMatch(/^v2:/);
    expect(open(onlyV2, conn.session_id_enc as string, aadFor("bank_session_id", A, connectionId))).toBe("sess-1");
    expect(open(onlyV2, cred.private_key_enc as string, aadFor("bank_private_key", A, cred.id as string))).toMatch(/PRIVATE KEY/);

    // Idempotent.
    expect(await rotateKek(ring)).toEqual({ resealed: 0, failed: 0 });
  }, 60_000);
});

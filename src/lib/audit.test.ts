import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./test-db";

// Must run before the lazy `@/db` proxy first connects (see test-db.ts).
const testDb = await setupTestDb("audit");

const { logAudit, logAuthEvent, logDataEvent, getRequestMeta, cleanupOldAuditLogs, toCsvCell } =
  await import("./audit");

async function allRows() {
  const res = await testDb.client.execute("SELECT * FROM audit_log");
  return res.rows;
}

afterAll(async () => {
  await testDb.cleanup();
});

describe("logAudit", () => {
  beforeEach(async () => {
    await testDb.reset();
  });

  it("writes a full audit row with JSON-serialized details", async () => {
    await logAudit({
      userId: "u1",
      category: "data",
      action: "transaction.update",
      targetId: "tx-1",
      targetType: "transaction",
      details: { field: "amount", from: 1, to: 2 },
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
    });
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe("u1");
    expect(rows[0].category).toBe("data");
    expect(rows[0].action).toBe("transaction.update");
    expect(JSON.parse(rows[0].details as string)).toEqual({
      field: "amount",
      from: 1,
      to: 2,
    });
  });

  it("defaults optional fields to null", async () => {
    await logAudit({ userId: null, category: "auth", action: "login.failed" });
    const [row] = await allRows();
    expect(row.user_id).toBeNull();
    expect(row.target_id).toBeNull();
    expect(row.details).toBeNull();
    expect(row.ip_address).toBeNull();
  });

  it("logAuthEvent and logDataEvent set their categories", async () => {
    await logAuthEvent({ userId: "u1", action: "login" });
    await logDataEvent({ userId: "u1", action: "account.create" });
    const rows = await allRows();
    expect(rows.map((r) => r.category).sort()).toEqual(["auth", "data"]);
  });

  it("never throws even when the write fails", async () => {
    await testDb.client.execute("ALTER TABLE audit_log RENAME TO audit_log_gone");
    try {
      await expect(
        logAudit({ userId: "u1", category: "data", action: "x" }),
      ).resolves.toBeUndefined();
    } finally {
      await testDb.client.execute("ALTER TABLE audit_log_gone RENAME TO audit_log");
    }
  });
});

describe("cleanupOldAuditLogs", () => {
  it("deletes only rows older than the retention window", async () => {
    await testDb.reset();
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await testDb.client.execute({
      sql: `INSERT INTO audit_log (id, category, action, created_at) VALUES (?, ?, ?, ?)`,
      args: ["old-row", "data", "x", old],
    });
    await logAudit({ userId: "u1", category: "data", action: "fresh" });

    expect(await cleanupOldAuditLogs(90)).toBe(1);
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("fresh");
  });

  it("preserves old pot.allocate rows — they are the pots allocation history", async () => {
    await testDb.reset();
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    for (const [id, action] of [["old-alloc", "pot.allocate"], ["old-other", "x"]]) {
      await testDb.client.execute({
        sql: `INSERT INTO audit_log (id, category, action, created_at) VALUES (?, ?, ?, ?)`,
        args: [id, "data", action, old],
      });
    }

    expect(await cleanupOldAuditLogs(90)).toBe(1);
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("pot.allocate");
  });
});

describe("toCsvCell", () => {
  it("passes plain values through and stringifies null/undefined to empty", () => {
    expect(toCsvCell("plain")).toBe("plain");
    expect(toCsvCell(42)).toBe("42");
    expect(toCsvCell(null)).toBe("");
    expect(toCsvCell(undefined)).toBe("");
  });

  it("quotes and escapes commas, quotes, and newlines", () => {
    expect(toCsvCell("a,b")).toBe('"a,b"');
    expect(toCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes spreadsheet formula triggers with a leading apostrophe", () => {
    expect(toCsvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(toCsvCell("+1")).toBe("'+1");
    expect(toCsvCell("-2")).toBe("'-2");
    expect(toCsvCell("@cmd")).toBe("'@cmd");
    expect(toCsvCell("normal =text")).toBe("normal =text");
  });
});

describe("getRequestMeta", () => {
  it("takes the LAST X-Forwarded-For entry (trusted-proxy-appended) as the client IP", () => {
    const headers = new Headers({
      "x-forwarded-for": "6.6.6.6, 1.2.3.4",
      "user-agent": "vitest",
    });
    expect(getRequestMeta(headers)).toEqual({
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
    });
  });

  it("falls back to X-Real-IP", () => {
    const headers = new Headers({ "x-real-ip": "9.9.9.9" });
    expect(getRequestMeta(headers)).toEqual({
      ipAddress: "9.9.9.9",
      userAgent: null,
    });
  });

  it("returns nulls when nothing is present", () => {
    expect(getRequestMeta(new Headers())).toEqual({
      ipAddress: null,
      userAgent: null,
    });
  });

  it("skips empty X-Forwarded-For entries", () => {
    expect(getRequestMeta(new Headers({ "x-forwarded-for": "2.2.2.2, " }))).toEqual({
      ipAddress: "2.2.2.2",
      userAgent: null,
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "file-store-"));
  process.env.FILE_STORAGE_DIR = root;
});

afterAll(async () => {
  delete process.env.FILE_STORAGE_DIR;
  await rm(root, { recursive: true, force: true });
});

import { deleteFile, putFile, readFile, resolveKey } from "@/lib/file-store";
import { isAttachmentPathname } from "@/lib/attachments";
import { isAvatarPathname } from "@/lib/avatar";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("file store", () => {
  it("round-trips bytes under a random, allowlist-shaped key", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const key = await putFile("attachments", "abc", "pdf", bytes);

    expect(key).toMatch(/^attachments\/abc-[0-9a-f]{30}\.pdf$/);
    expect(isAttachmentPathname(key)).toBe(true);

    const file = await readFile(key);
    expect(file).not.toBeNull();
    expect(file!.size).toBe(4);
    expect(file!.contentType).toBe("application/pdf");
    expect([...(await readAll(file!.stream))]).toEqual([1, 2, 3, 4]);
  });

  it("produces avatar keys the avatar allowlist accepts", async () => {
    const key = await putFile("avatars", "user-1", "webp", new Uint8Array([9]));
    expect(isAvatarPathname(key)).toBe(true);
    expect((await readFile(key))!.contentType).toBe("image/webp");
  });

  it("never reuses a key", async () => {
    const a = await putFile("avatars", "same", "webp", new Uint8Array([1]));
    const b = await putFile("avatars", "same", "webp", new Uint8Array([2]));
    expect(a).not.toBe(b);
  });

  it("writes owner-only files and leaves no temp files behind", async () => {
    const key = await putFile("attachments", "perm", "pdf", new Uint8Array([1]));
    const info = await stat(resolveKey(key)!);
    expect(info.mode & 0o777).toBe(0o600);
    const leftovers = (await readdir(path.join(root, "attachments"))).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("deletes, and treats a missing file as already gone", async () => {
    const key = await putFile("attachments", "gone", "pdf", new Uint8Array([1]));
    await deleteFile(key);
    expect(await readFile(key)).toBeNull();
    await expect(deleteFile(key)).resolves.toBeUndefined();
  });

  it.each([
    "../etc/passwd",
    "attachments/../../etc/passwd.pdf",
    "attachments/..%2f..%2fx.pdf",
    "/etc/passwd",
    "attachments/sub/dir.pdf",
    "attachments/x.svg",
    "other/x.webp",
    "",
  ])("refuses key %j", async (key) => {
    expect(resolveKey(key)).toBeNull();
    expect(await readFile(key)).toBeNull();
    await expect(deleteFile(key)).resolves.toBeUndefined();
  });
});

/**
 * One-off: copy every avatar and attachment out of the Vercel Blob store into
 * ./blob-export/<same key>, ready to be placed in the server's file store.
 *
 * Auth is Vercel OIDC (no static token needed). Connect the Blob store to the
 * project's Development environment, then:
 *
 *   vercel env pull --environment=development .env.vercel
 *   pnpm tsx --env-file=.env.vercel scripts/export-vercel-blob.ts
 *   rm .env.vercel
 *
 * Re-running skips files that were already downloaded.
 */
import { get, list } from "@vercel/blob";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("blob-export");
const KEY = /^(avatars|attachments)\/[A-Za-z0-9._-]+\.(webp|pdf)$/;

async function exists(file: string): Promise<boolean> {
  return stat(file).then(() => true, () => false);
}

async function main() {
  let cursor: string | undefined;
  let copied = 0;
  let skipped = 0;
  let ignored = 0;

  do {
    const page = await list({ cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (!KEY.test(blob.pathname)) {
        ignored++;
        console.warn(`ignoring unexpected key: ${blob.pathname}`);
        continue;
      }
      const target = path.join(OUT, blob.pathname);
      if (await exists(target)) {
        skipped++;
        continue;
      }
      const file = await get(blob.pathname, { access: "private" });
      if (!file || file.statusCode !== 200) {
        throw new Error(`could not download ${blob.pathname}`);
      }
      const bytes = Buffer.from(await new Response(file.stream).arrayBuffer());
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      copied++;
      console.log(`copied ${blob.pathname} (${bytes.byteLength} bytes)`);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  console.log(`\nDone: ${copied} copied, ${skipped} already there, ${ignored} ignored -> ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

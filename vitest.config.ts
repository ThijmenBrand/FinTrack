import { defineConfig } from "vitest/config";
import path from "node:path";

// Force UTC so date math is deterministic across local machines and CI.
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

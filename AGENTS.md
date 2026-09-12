# Repository instructions

## SQL safety

This codebase uses Drizzle ORM with libsql/SQLite. All queries must be parameterized.

**Banned:** `sql.raw(...)` — it interpolates strings without binding and is the only Drizzle escape hatch that bypasses parameterization. Do not use it anywhere user input could reach. If you genuinely need a dynamic identifier (table or column name), use `sql.identifier(...)`.

**Required patterns:**
- Drizzle operators (`eq`, `and`, `or`, `gte`, `lte`, `like`, `inArray`) for all `WHERE` clauses.
- `sql\`...\`` template literals with `${value}` substitutions — these are bound parameters, not interpolations.
- For LIKE patterns, build the pattern as a string (`` `%${input}%` ``) and pass the whole string into the `${}` slot of a `sql\`` template — wildcards travel as data, not SQL.
- For dynamic ORDER BY columns, map user input through an allowlist of column references; never pass user input into `sql.raw`.
- Validate enum-like query params (e.g. `type`, `matchType`) against an explicit allowlist before use.

**Pattern length:** category-rule patterns must be validated with `validatePattern` from `@/lib/validation` (max 200 chars). Don't store unbounded user-supplied LIKE patterns.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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

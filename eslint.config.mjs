import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

const ADMIN_DB_MESSAGE =
  "adminDb bypasses the tenant guard — only admin/backoffice and migration code may use it.";
const ADMIN_DB_PATHS = [
  { name: "@/db", importNames: ["adminDb"], message: ADMIN_DB_MESSAGE },
  { name: "@/db/index", importNames: ["adminDb"], message: ADMIN_DB_MESSAGE },
];
const WORKER_PATTERNS = [
  {
    group: ["@/worker", "@/worker/*", "**/worker/*", "**/worker/**"],
    message:
      "src/worker is the bank-sync worker (its own container, holding the master key). The web app talks to it only through the jobs table.",
  },
];

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "dist/**",
      "node_modules/**",
      "data/**",
      "public/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      "src/db/auth-schema.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // CLAUDE.md: sql.raw interpolates without binding parameters. Use
      // sql`` templates or sql.identifier() instead.
      "no-restricted-syntax": [
        "error",
        {
          selector: 'MemberExpression[object.name="sql"][property.name="raw"]',
          message:
            "sql.raw bypasses parameterization. Use sql`` bindings or sql.identifier().",
        },
      ],
      // adminDb skips the tenant guard; only backoffice and bootstrap code
      // (allowlisted below) may take it. And the bank-sync worker is a
      // separate process holding the master key: nothing outside it may
      // import its code — the web app must not even be able to decrypt.
      "no-restricted-imports": ["error", { paths: ADMIN_DB_PATHS, patterns: WORKER_PATTERNS }],
    },
  },
  {
    // The worker itself may of course import its own modules.
    files: ["src/worker/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: ADMIN_DB_PATHS }],
    },
  },
  {
    files: ["src/app/api/admin/**", "src/db/**", "src/lib/audit.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["**/*.config.{js,mjs,cjs,ts}", "scripts/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
);

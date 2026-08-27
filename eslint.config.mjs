import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/drizzle/**",
      "**/playwright-report/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Web app: server actions log magic links in dev; allow console there.
    files: ["apps/web/src/auth.ts", "packages/db/src/migrate.ts", "packages/db/src/seed.ts"],
    rules: { "no-console": "off" },
  },
  {
    /**
     * SafeFetcher discipline (spec §2): external HTTP in ingestion/discovery
     * code goes through the SafeFetcher seam — raw fetch is banned there.
     * (Dirs arrive in Phase 1; the rule is in force from day one.)
     */
    files: [
      "packages/core/src/providers/**",
      "packages/core/src/ingestion/**",
      "packages/core/src/contacts/discovery/**",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Use SafeFetcher — raw fetch bypasses SSRF guard, rate limits, and the circuit breaker.",
        },
      ],
    },
  },
);

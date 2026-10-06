import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@decisionator/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@decisionator/plugin-sdk/testing": path.resolve(
        __dirname,
        "packages/plugin-sdk/testing/index.ts"
      ),
      "@decisionator/plugin-sdk": path.resolve(__dirname, "packages/plugin-sdk/src/index.ts"),
    },
  },
  test: {
    globals: true,
    // Password-protected store tests derive keys with production PBKDF2 (600 000 iterations);
    // under a full parallel run they can exceed the 5 s default.
    testTimeout: 30_000,
    // .claude/worktrees holds other agent sessions' checkouts; never test them from here.
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**", ".claude/**"],
  },
});

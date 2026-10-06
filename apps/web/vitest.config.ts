import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@decisionator/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@decisionator/plugin-sdk/testing": path.resolve(
        __dirname,
        "../../packages/plugin-sdk/testing/index.ts"
      ),
      "@decisionator/plugin-sdk": path.resolve(__dirname, "../../packages/plugin-sdk/src/index.ts"),
    },
  },
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});

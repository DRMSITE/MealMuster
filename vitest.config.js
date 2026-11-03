import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["shared/**", "functions/src/**", "web/src/**"],
      exclude: ["**/*.test.js", "functions/src/shared/**"],
    },
  },
});

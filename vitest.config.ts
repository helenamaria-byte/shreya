import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 300000,
    retry: 2, // the Neon HTTP connection from this machine drops intermittently; real failures fail every attempt
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __DEV__: false,
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});

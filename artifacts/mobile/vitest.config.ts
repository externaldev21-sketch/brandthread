import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __DEV__: false,
  },
  resolve: {
    alias: {
      "@/lib/revenueCat": new URL("./lib/revenueCat.web.tsx", import.meta.url).pathname,
      // FlashList needs native layout; tests render every row instead.
      "@shopify/flash-list": new URL("./tests/shims/flash-list.tsx", import.meta.url).pathname,
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});

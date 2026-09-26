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
      // The real react-native-reanimated/gesture-handler packages fail to
      // resolve under Vitest's ESM resolver in this environment (unrelated
      // to app code) — any suite that transitively renders a sheet built on
      // components/ui/BottomSheet.tsx hits this. A suite that already mocks
      // either module itself (vi.mock(...)) is unaffected: that mock takes
      // precedence over this alias.
      "react-native-reanimated": new URL("./tests/shims/reanimated.tsx", import.meta.url).pathname,
      "react-native-gesture-handler": new URL("./tests/shims/gesture-handler.tsx", import.meta.url).pathname,
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});

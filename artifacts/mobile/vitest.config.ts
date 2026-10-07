import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __DEV__: false,
  },
  resolve: {
    alias: {
      "react-native": new URL("./tests/shims/react-native.tsx", import.meta.url).pathname,
      "@expo/vector-icons": new URL("./tests/shims/vector-icons.tsx", import.meta.url).pathname,
      "expo-constants": new URL("./tests/shims/expo-constants.ts", import.meta.url).pathname,
      "expo-image": new URL("./tests/shims/expo-image.tsx", import.meta.url).pathname,
      "expo-asset": new URL("./tests/shims/expo-asset.ts", import.meta.url).pathname,
      "expo-secure-store": new URL("./tests/shims/secure-store.ts", import.meta.url).pathname,
      "expo-file-system": new URL("./tests/shims/file-system.ts", import.meta.url).pathname,
      "expo-sharing": new URL("./tests/shims/sharing.ts", import.meta.url).pathname,
      "expo-linear-gradient": new URL("./tests/shims/expo-ui.tsx", import.meta.url).pathname,
      "expo-blur": new URL("./tests/shims/expo-ui.tsx", import.meta.url).pathname,
      "expo-video": new URL("./tests/shims/expo-ui.tsx", import.meta.url).pathname,
      "expo-haptics": new URL("./tests/shims/haptics.ts", import.meta.url).pathname,
      "expo-local-authentication": new URL("./tests/shims/local-authentication.ts", import.meta.url).pathname,
      "expo-print": new URL("./tests/shims/print.ts", import.meta.url).pathname,
      "expo-notifications": new URL("./tests/shims/notifications.ts", import.meta.url).pathname,
      "@clerk/expo": new URL("./tests/shims/clerk.tsx", import.meta.url).pathname,
      "@react-native-async-storage/async-storage": new URL("./tests/shims/async-storage.ts", import.meta.url).pathname,
      "@react-navigation/native": new URL("./tests/shims/navigation.ts", import.meta.url).pathname,
      "expo-router/react-navigation": new URL("./tests/shims/navigation.ts", import.meta.url).pathname,
      "expo-crypto": new URL("./tests/shims/crypto.ts", import.meta.url).pathname,
      "react-native-safe-area-context": new URL("./tests/shims/safe-area.tsx", import.meta.url).pathname,
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
      // Same class of issue as reanimated/gesture-handler above (a
      // Flow-annotated file the ESM resolver can't parse), not app code.
      "react-native-svg": new URL("./tests/shims/react-native-svg.tsx", import.meta.url).pathname,
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/nativeAssetSetup.ts"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});

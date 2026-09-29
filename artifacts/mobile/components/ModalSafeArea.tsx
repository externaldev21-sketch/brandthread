/**
 * Wraps a native <Modal>'s content so `useSafeAreaInsets()` /
 * `useHeaderTopInset()` / `ScreenHeader` read correct insets inside it.
 *
 * React Native's <Modal> mounts its content into a *new native root*
 * (RCTModalHostView on iOS, a separate window on Android) — the app's own
 * top-level <SafeAreaProvider> (app/_layout.tsx) only measures the main
 * window, so a modal that just inherits that context can read stale or
 * zeroed insets, and its header ends up under the notch/Dynamic Island or
 * its footer under the home indicator. This is a documented
 * react-native-safe-area-context caveat: a `<Modal>`'s content needs its
 * own `<SafeAreaProvider>` so it gets a fresh, correct measurement for its
 * own native root.
 *
 * `PhoneFrameSafeArea` is nested the same way the root layout nests it, so
 * the web phone-frame preview (dev-web at phone width) simulates the same
 * notch/home-indicator insets inside a modal as everywhere else in the app.
 *
 * Usage: put this immediately inside every `<Modal>`'s `visible` boundary,
 * wrapping everything the modal renders:
 *
 *   <Modal visible={open} animationType="slide" onRequestClose={close}>
 *     <ModalSafeArea>
 *       <ScreenHeader title="Choose products" variant="modal" onBack={close} />
 *       ...
 *     </ModalSafeArea>
 *   </Modal>
 */
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PhoneFrameSafeArea } from '@/components/web/PhoneFrameSafeArea';

export function ModalSafeArea({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <PhoneFrameSafeArea>
        {children}
      </PhoneFrameSafeArea>
    </SafeAreaProvider>
  );
}

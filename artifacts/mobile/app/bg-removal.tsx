/**
 * Background Removal — redirects to the canonical Design Studio background
 * removal screen.
 *
 * design-bg-removal.tsx is the single source of truth for this tool
 * (already linked from more.tsx, (tabs)/studio.tsx, and
 * lib/sellerControlCenter.ts). This file used to be a separate, older
 * implementation of the same feature and was still linked from
 * ai-studio.tsx — now fixed to point at design-bg-removal directly. This
 * file exists only for backward compatibility with any route/deep link
 * that still navigates to /bg-removal. It immediately redirects so there
 * is no separate state or duplicate implementation.
 */
import { Redirect } from 'expo-router';

export default function BackgroundRemovalScreen() {
  return <Redirect href="/design-bg-removal" />;
}

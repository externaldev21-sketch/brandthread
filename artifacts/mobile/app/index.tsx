/**
 * Index route — the AuthGate in app/_layout.tsx immediately redirects
 * from "/" to splash, sign-in, or the correct dashboard. This screen
 * only shows the branded boot view for the brief moment before that
 * redirect fires (previously "/" matched no route and rendered blank).
 */

import BootScreen from '@/components/BootScreen';

export default function Index() {
  return <BootScreen />;
}

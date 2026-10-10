/**
 * Mounted once at the app root: shows the Share store sheet whenever
 * lib/shareStoreSheet's openShareStoreSheet() is called.
 */
import React, { lazy, Suspense, useEffect, useState } from 'react';

import { subscribeShareStoreSheet } from '@/lib/shareStoreSheet';

// QR generation and the store thumbnail are loaded only after an explicit
// share action, never as part of the root screen's startup import graph.
const ShareStoreSheet = lazy(() => import('@/components/store/ShareStoreSheet')
  .then(module => ({ default: module.ShareStoreSheet })));

export function ShareStoreSheetHost() {
  const [visible, setVisible] = useState(false);
  const [opened, setOpened] = useState(false);
  useEffect(() => subscribeShareStoreSheet(() => { setOpened(true); setVisible(true); }), []);
  if (!opened) return null;
  return <Suspense fallback={null}><ShareStoreSheet visible={visible} onClose={() => setVisible(false)} /></Suspense>;
}

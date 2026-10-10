/**
 * Mounted once at the app root: shows the Share store sheet whenever
 * lib/shareStoreSheet's openShareStoreSheet() is called.
 */
import React, { useEffect, useState } from 'react';

import { ShareStoreSheet } from '@/components/store/ShareStoreSheet';
import { subscribeShareStoreSheet } from '@/lib/shareStoreSheet';

export function ShareStoreSheetHost() {
  const [visible, setVisible] = useState(false);
  useEffect(() => subscribeShareStoreSheet(() => setVisible(true)), []);
  return <ShareStoreSheet visible={visible} onClose={() => setVisible(false)} />;
}

/**
 * The viewer's "Use less cellular data" choice (Settings → Media quality and
 * data usage), re-read whenever the screen regains focus so flipping it in
 * Settings applies as soon as you come back. Polish #154.
 */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadBuyerSettings } from '@/lib/buyerSettings';

export function useDataSaverSetting(): boolean {
  const [on, setOn] = useState(false);
  useFocusEffect(useCallback(() => {
    let alive = true;
    loadBuyerSettings().then((s) => { if (alive) setOn(!!s.dataSaver); }).catch(() => {});
    return () => { alive = false; };
  }, []));
  return on;
}

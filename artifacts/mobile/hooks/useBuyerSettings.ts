import { useEffect, useSyncExternalStore } from 'react';
import { getBuyerSettingsSnapshot, loadBuyerSettings, subscribeBuyerSettings, type BuyerSettingsState } from '@/lib/buyerSettings';

/**
 * Live buyer settings (privacy / content / accessibility). Re-renders when a
 * setting changes anywhere in the app — e.g. Hide like counts, Autoplay
 * videos, Always show captions — so display code can just read it.
 */
export function useBuyerSettings(): BuyerSettingsState {
  const settings = useSyncExternalStore(subscribeBuyerSettings, getBuyerSettingsSnapshot, getBuyerSettingsSnapshot);
  useEffect(() => { void loadBuyerSettings(); }, []);
  return settings;
}

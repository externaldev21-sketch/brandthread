import { useSyncExternalStore } from 'react';
import {
  getNetworkNotice,
  subscribeNetworkNotice,
} from '@/lib/networkNotice';

export function useNetworkNotice() {
  return useSyncExternalStore(
    subscribeNetworkNotice,
    getNetworkNotice,
    getNetworkNotice,
  );
}
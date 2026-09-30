import { goBackOr, type BackCapableRouter } from './goBackOr';

export const STUDIO_MENU_ORIGIN = 'seller-studio';

const listeners = new Set<() => void>();

/** The Studio menu is an overlay, so popping a route alone cannot restore it. */
export function subscribeStudioMenuReturn(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function returnToStudioMenu(router: BackCapableRouter): void {
  goBackOr(router, '/(tabs)/more');
  for (const listener of [...listeners]) listener();
}
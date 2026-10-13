/**
 * "What's new" release notes, shown once in a sheet after an update.
 *
 * To announce a release: replace `id` with a new value (the app version is a
 * good choice) and rewrite `items`. Everyone who saw an older id gets the
 * sheet once, the next time they land on a home tab. A fresh install never
 * sees it: there is nothing "new" on day one. Keep it to what shipped, 3–5
 * items, one short line each.
 */
import type { Feather } from '@expo/vector-icons';

export interface WhatsNewItem {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
}

export interface WhatsNewNotes {
  id: string;
  items: WhatsNewItem[];
}

export const WHATS_NEW: WhatsNewNotes = {
  id: '1.0.0',
  items: [
    { icon: 'hash', title: 'Shorter order numbers', body: 'New orders get a number like BT-4821 that\'s easy to read out.' },
    { icon: 'volume-2', title: 'Sale sound', body: 'Hear a cha-ching when an order comes in. Turn it off in Notifications.' },
    { icon: 'wifi-off', title: 'Orders offline', body: 'Your latest orders still open when you lose signal.' },
  ],
};

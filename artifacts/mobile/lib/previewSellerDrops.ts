/**
 * Seller Drops list and drop waitlist data for the signed-out web preview
 * only (`?bt_preview=seller`); the seller preview never calls the API.
 * `?demo=1` shows two upcoming and two past drops; fresh shows none.
 */
import type { DropHype } from '@/lib/dropHype';

const DAY_MS = 86_400_000;

export interface PreviewSellerDrop {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'closed' | 'fulfilled';
  releaseAt: string | null;
}

function atLocal(now: Date, daysFromToday: number, hour: number): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday, hour, 0, 0).toISOString();
}

export function previewSellerDrops(mode: 'demo' | 'fresh', now: Date = new Date()): PreviewSellerDrop[] {
  if (mode === 'fresh') return [];
  return [
    { id: 'preview-drop-night-shift', name: 'Night Shift Capsule', status: 'active', releaseAt: atLocal(now, 3, 18) },
    { id: 'preview-drop-field-shell', name: 'Field Shell Jacket', status: 'draft', releaseAt: atLocal(now, 12, 12) },
    { id: 'preview-drop-ember', name: 'Ember Season', status: 'closed', releaseAt: atLocal(now, -21, 18) },
    { id: 'preview-drop-hoodie', name: 'Heavyweight Hoodie', status: 'fulfilled', releaseAt: atLocal(now, -64, 18) },
  ];
}

// Daily signups for the demo drops, oldest first; the last entry is today.
const DEMO_DAILY: Record<string, number[]> = {
  'preview-drop-night-shift': [14, 9, 6, 4, 5, 3, 2, 4, 3, 6, 5, 4, 9, 12, 8, 11, 17, 23],
  'preview-drop-field-shell': [6, 2, 1, 0, 0, 3, 1, 2, 0],
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function previewDropHype(dropId: string, mode: 'demo' | 'fresh', now: Date = new Date()): DropHype | null {
  const drop = previewSellerDrops(mode, now).find((d) => d.id === dropId);
  if (!drop) return null;
  const daily = DEMO_DAILY[dropId] ?? [];
  let running = 0;
  const series = daily.map((count, i) => {
    running += count;
    const day = new Date(now.getTime() - (daily.length - 1 - i) * DAY_MS);
    return { date: dayKey(day), cumulative: running };
  });
  // Followers: a steady share of the list, so the split reads like real data.
  const followers = Math.round(running * 0.62);
  return {
    dropId: drop.id,
    name: drop.name,
    releaseAt: drop.releaseAt,
    total: running,
    today: daily[daily.length - 1] ?? 0,
    followers,
    series,
  };
}

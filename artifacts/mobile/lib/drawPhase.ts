/**
 * Where a buyer stands in a draw (SNKRS wording), from the server's draw
 * state, their entry and the server-skewed clock. Pure: no React, no clock.
 */
import type { ProductDrawEntry, ProductDrawState } from '@/lib/api';

export type DrawPhase =
  | { kind: 'upcoming' }                 // entries haven't opened (the lobby shows the countdown)
  | { kind: 'open' }                     // can enter
  | { kind: 'entered' }                  // in, waiting for the draw
  | { kind: 'closed' }                   // entries closed, not entered (or the draw is running)
  | { kind: 'won' }
  | { kind: 'lost' };

export function drawPhase(draw: ProductDrawState, entry: ProductDrawEntry | null, nowMs: number): DrawPhase {
  const status = entry?.status;
  if (status === 'won') return { kind: 'won' };
  if (status === 'lost' || status === 'charge_failed') return { kind: 'lost' };
  if (draw.status === 'open' && nowMs < Date.parse(draw.opensAt)) return { kind: 'upcoming' };
  const open = draw.status === 'open' && nowMs < Date.parse(draw.closesAt);
  if (status === 'entered') return { kind: 'entered' };
  return open ? { kind: 'open' } : { kind: 'closed' };
}

/** The product page's one footer button for a draw product. */
export function drawFooter(phase: DrawPhase): { label: string; enabled: boolean; target: 'entry' | 'result' | null } {
  switch (phase.kind) {
    case 'upcoming': return { label: 'Enter Draw', enabled: false, target: null };
    case 'open': return { label: 'Enter Draw', enabled: true, target: 'entry' };
    case 'entered': return { label: 'Entered', enabled: true, target: 'entry' };
    case 'closed': return { label: 'Draw closed', enabled: false, target: null };
    case 'won':
    case 'lost': return { label: 'See result', enabled: true, target: 'result' };
  }
}

/** "Entries close 10/17 at 10:00 AM" in the viewer's own timezone. */
export function closesLabel(iso: string, locale = 'en-US', timeZone?: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(locale, { month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) });
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
  return `Entries close ${date} at ${time}`;
}

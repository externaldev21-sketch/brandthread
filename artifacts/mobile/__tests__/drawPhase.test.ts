import { describe, expect, it } from 'vitest';
import { closesLabel, drawFooter, drawPhase } from '@/lib/drawPhase';
import type { ProductDrawEntry, ProductDrawState } from '@/lib/api';

const draw = (over: Partial<ProductDrawState> = {}): ProductDrawState => ({
  productId: 'p', status: 'open', opensAt: '2026-10-16T17:00:00Z', closesAt: '2026-10-16T19:00:00Z', seedHash: 'h', drawnAt: null, ...over,
});
const entry = (status: string): ProductDrawEntry => ({ id: 'e', status, variantId: 'v', variantLabel: 'M', amountCents: 100, notifyResult: false, decidedAt: null });
const at = (iso: string) => Date.parse(iso);

describe('drawPhase', () => {
  it('walks upcoming → open → closed for someone who never enters', () => {
    expect(drawPhase(draw(), null, at('2026-10-16T16:59:59Z')).kind).toBe('upcoming');
    expect(drawPhase(draw(), null, at('2026-10-16T17:00:00Z')).kind).toBe('open');
    expect(drawPhase(draw(), null, at('2026-10-16T19:00:00Z')).kind).toBe('closed');
    expect(drawPhase(draw({ status: 'drawing' }), null, at('2026-10-16T18:00:00Z')).kind).toBe('closed');
  });

  it('shows entered until the result, then the result', () => {
    expect(drawPhase(draw(), entry('entered'), at('2026-10-16T18:00:00Z')).kind).toBe('entered');
    expect(drawPhase(draw({ status: 'drawing' }), entry('entered'), at('2026-10-16T19:00:30Z')).kind).toBe('entered');
    expect(drawPhase(draw({ status: 'drawn' }), entry('won'), at('2026-10-16T19:01:00Z')).kind).toBe('won');
    expect(drawPhase(draw({ status: 'drawn' }), entry('lost'), at('2026-10-16T19:01:00Z')).kind).toBe('lost');
    // A declined capture reads the same as not being picked.
    expect(drawPhase(draw({ status: 'drawn' }), entry('charge_failed'), at('2026-10-16T19:01:00Z')).kind).toBe('lost');
    // An unconfirmed (pending) entry is not "entered".
    expect(drawPhase(draw(), entry('pending'), at('2026-10-16T18:00:00Z')).kind).toBe('open');
  });

  it('maps each phase to one footer button', () => {
    expect(drawFooter({ kind: 'open' })).toEqual({ label: 'Enter Draw', enabled: true, target: 'entry' });
    expect(drawFooter({ kind: 'upcoming' }).enabled).toBe(false);
    expect(drawFooter({ kind: 'entered' })).toMatchObject({ label: 'Entered', target: 'entry' });
    expect(drawFooter({ kind: 'won' }).target).toBe('result');
    expect(drawFooter({ kind: 'closed' })).toMatchObject({ label: 'Draw closed', enabled: false });
  });

  it('labels the close time in the viewer timezone', () => {
    expect(closesLabel('2026-10-16T19:00:00Z', 'en-US', 'America/Los_Angeles')).toBe('Entries close 10/16 at 12:00 PM');
  });
});

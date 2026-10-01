import { describe, expect, it } from 'vitest';
import { classifyAiCreditsError } from './aiCreditsError';
import { buildCreditsReturnUrl, creditsNoteState, entryLabel, formatDelta, formatResetDate, topUpRoute } from './aiCredits';

const tools = [{ tool: 'logo', label: 'Logo', cost: 5 }];

describe('classifyAiCreditsError', () => {
  it('recognises the three gate refusals only with their matching status', () => {
    expect(classifyAiCreditsError(402, JSON.stringify({ code: 'insufficient_credits' }))).toBe('insufficient_credits');
    expect(classifyAiCreditsError(429, JSON.stringify({ code: 'user_daily_cap' }))).toBe('user_daily_cap');
    expect(classifyAiCreditsError(503, JSON.stringify({ code: 'global_daily_cap' }))).toBe('global_daily_cap');
    expect(classifyAiCreditsError(402, JSON.stringify({ code: 'user_daily_cap' }))).toBeNull();
  });
  it('ignores other errors', () => {
    expect(classifyAiCreditsError(500, JSON.stringify({ code: 'insufficient_credits' }))).toBeNull();
    expect(classifyAiCreditsError(429, 'Too many requests')).toBeNull();
    expect(classifyAiCreditsError(402, undefined)).toBeNull();
  });
});

describe('credits helpers', () => {
  it('labels ledger rows with the tool name', () => {
    expect(entryLabel({ kind: 'debit', toolKey: 'logo' }, tools)).toBe('Logo');
    expect(entryLabel({ kind: 'refund', toolKey: 'logo' }, tools)).toBe('Logo refunded');
    expect(entryLabel({ kind: 'pack_purchase', toolKey: null }, tools)).toBe('Credit pack');
    expect(entryLabel({ kind: 'debit', toolKey: 'gone' }, tools)).toBe('AI tool');
  });
  it('formats deltas and dates', () => {
    expect(formatDelta(-5)).toBe('−5');
    expect(formatDelta(1000)).toBe('+1,000');
    expect(formatResetDate('2026-10-01T00:00:00.000Z')).toBe('Oct 1');
  });
  it('builds return urls', () => {
    expect(buildCreditsReturnUrl()).toBe('brandthread://ai-credits/?paymentReturn=1');
    expect(buildCreditsReturnUrl('https://x.app')).toBe('https://x.app/ai-credits?paymentReturn=1');
  });
});

describe('inline note state', () => {
  it('shows nothing for Pro, unknown or healthy balances', () => {
    expect(creditsNoteState(null)).toBe('none');
    expect(creditsNoteState({ unlimited: true, balance: null, isLow: false })).toBe('none');
    expect(creditsNoteState({ unlimited: false, balance: 900, isLow: false })).toBe('none');
  });
  it('shows one low note at 20% and a top-up row at zero', () => {
    expect(creditsNoteState({ unlimited: false, balance: 150, isLow: true })).toBe('low');
    expect(creditsNoteState({ unlimited: false, balance: 0, isLow: true })).toBe('empty');
  });
  it('sends pack buyers to the credits screen and everyone else to plans', () => {
    expect(topUpRoute({ packs: [{ id: 'credits_500', credits: 500, amountCents: 599, label: '500 credits' }] })).toBe('/ai-credits');
    expect(topUpRoute({ packs: [] })).toBe('/plans');
  });
  it('labels rollover rows', () => {
    expect(entryLabel({ kind: 'rollover', toolKey: null }, [])).toBe('Rolled over from last month');
    expect(entryLabel({ kind: 'rollover_expire', toolKey: null }, [])).toBe('Rollover credits expired');
  });
});

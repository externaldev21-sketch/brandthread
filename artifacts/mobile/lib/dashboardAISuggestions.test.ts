import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/services/aiTypes';
import {
  dashboardSuggestionsEnabled,
  safeSuggestionRoute,
  selectDashboardSuggestions,
  suggestionAIBrainParams,
  suggestionPrompt,
} from './dashboardAISuggestions';

function settings(overrides: Partial<AISettings> = {}, ds: Partial<AISettings['dataSources']> = {}): AISettings {
  return { ...DEFAULT_AI_SETTINGS, ...overrides, dataSources: { ...DEFAULT_AI_SETTINGS.dataSources, ...ds } };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'sug_ship_unfulfilled',
  title: '2 orders awaiting fulfilment',
  reason: '2 paid orders are awaiting fulfilment.',
  expectedImpact: 'Protects your seller rating',
  actionLabel: 'View orders',
  actionRoute: '/(tabs)/orders',
  category: 'orders',
  priority: 'high',
  ...over,
});

describe('dashboardSuggestionsEnabled', () => {
  it('needs both the assistant and dashboard suggestions on', () => {
    expect(dashboardSuggestionsEnabled(settings())).toBe(true);
    expect(dashboardSuggestionsEnabled(settings({ suggestionsEnabled: false }))).toBe(false);
    expect(dashboardSuggestionsEnabled(settings({ enabled: false }))).toBe(false);
    expect(dashboardSuggestionsEnabled(null)).toBe(false);
  });
});

describe('selectDashboardSuggestions', () => {
  it('returns nothing when Dashboard suggestions is off', () => {
    expect(selectDashboardSuggestions({ suggestions: [row()] }, settings({ suggestionsEnabled: false }))).toEqual([]);
    expect(selectDashboardSuggestions({ suggestions: [row()] }, settings({ enabled: false }))).toEqual([]);
  });

  it('drops categories whose data source is off', () => {
    const out = selectDashboardSuggestions(
      { suggestions: [row(), row({ id: 'sug_stock_a', category: 'inventory' })] },
      settings({}, { orders: false }),
    );
    expect(out.map((s) => s.id)).toEqual(['sug_stock_a']);
  });

  it('drops malformed rows and duplicates, sorts most urgent first, caps the count', () => {
    const out = selectDashboardSuggestions({
      suggestions: [
        null,
        { id: '', title: 'x' },
        row({ id: 'a', priority: 'medium', category: 'content' }),
        row({ id: 'b', priority: 'urgent', category: 'inventory' }),
        row({ id: 'b', priority: 'urgent', category: 'inventory' }),
        row({ id: 'c', priority: 'high' }),
        row({ id: 'd', priority: 'low' }),
      ],
    }, settings());
    expect(out.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('handles a missing or bad body', () => {
    expect(selectDashboardSuggestions(undefined, settings())).toEqual([]);
    expect(selectDashboardSuggestions({ suggestions: 'nope' }, settings())).toEqual([]);
  });

  it('keeps only in-app routes', () => {
    const out = selectDashboardSuggestions({ suggestions: [row({ actionRoute: 'https://evil.test' })] }, settings());
    expect(out[0].actionRoute).toBeUndefined();
  });
});

describe('safeSuggestionRoute', () => {
  it('accepts app paths only', () => {
    expect(safeSuggestionRoute('/(tabs)/products?filter=out-of-stock')).toBe('/(tabs)/products?filter=out-of-stock');
    // The removed Inventory screen: older servers still send it, so it opens Products' low-stock filter.
    expect(safeSuggestionRoute('/inventory')).toBe('/(tabs)/products?filter=low-stock');
    expect(safeSuggestionRoute('/(tabs)/orders')).toBe('/(tabs)/orders');
    expect(safeSuggestionRoute('//evil.test')).toBeUndefined();
    expect(safeSuggestionRoute('javascript:alert(1)')).toBeUndefined();
    expect(safeSuggestionRoute(42)).toBeUndefined();
  });
});

describe('suggestion prompt for AI Brain', () => {
  it('uses the server context prompt when present', () => {
    expect(suggestionPrompt({ title: 't', reason: 'r', contextPrompt: 'Draft a restock order' })).toBe('Draft a restock order');
  });

  it('otherwise builds one from the suggestion itself', () => {
    expect(suggestionPrompt({ title: 'Low stock: Tee', reason: 'Only 2 left.' }))
      .toBe('Low stock: Tee. Only 2 left. What should I do about this?');
  });

  it('opens AI Brain in the matching screen context', () => {
    const [s] = selectDashboardSuggestions({ suggestions: [row({ category: 'inventory' })] }, settings());
    const params = suggestionAIBrainParams(s);
    expect(JSON.parse(params.context)).toEqual({ screen: 'inventory' });
    expect(params.prompt).toContain('awaiting fulfilment');
  });
});

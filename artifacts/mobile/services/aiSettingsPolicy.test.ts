import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS, AISettings } from './aiTypes';
import {
  actionConfirmationReason,
  aiDisabledError,
  confirmationCopy,
  isAIDisabledError,
  normalizeAISettings,
  suggestionCategoryAllowed,
} from './aiSettingsPolicy';

function settings(overrides: Partial<AISettings> = {}, ds: Partial<AISettings['dataSources']> = {}): AISettings {
  return { ...DEFAULT_AI_SETTINGS, ...overrides, dataSources: { ...DEFAULT_AI_SETTINGS.dataSources, ...ds } };
}

const card = (over: Partial<Parameters<typeof actionConfirmationReason>[0]> = {}) => ({
  type: 'recommend' as const,
  title: 'Try a bundle',
  description: '',
  isDestructive: false,
  requiresConfirmation: false,
  ...over,
});

describe('normalizeAISettings', () => {
  it('fills defaults and drops junk', () => {
    const out = normalizeAISettings({ enabled: 'nope', confirmSending: false, dataSources: { customers: false, x: true }, y: 1 });
    expect(out.enabled).toBe(true);
    expect(out.confirmSending).toBe(false);
    expect(out.dataSources.customers).toBe(false);
    expect(out.dataSources.orders).toBe(true);
    expect(out).not.toHaveProperty('y');
    expect(out.dataSources).not.toHaveProperty('x');
  });

  it('returns a fresh copy of the defaults for empty input', () => {
    const out = normalizeAISettings(undefined);
    expect(out).toEqual(DEFAULT_AI_SETTINGS);
    out.dataSources.orders = false;
    expect(DEFAULT_AI_SETTINGS.dataSources.orders).toBe(true);
  });
});

describe('actionConfirmationReason', () => {
  const none = settings({
    confirmSensitiveActions: false, confirmDestructiveActions: false, confirmPublishing: false, confirmSending: false,
  });

  it('asks for each class while its toggle is on', () => {
    expect(actionConfirmationReason(card({ type: 'edit', isDestructive: true, title: 'Delete product' }), settings())).toBe('destructive');
    expect(actionConfirmationReason(card({ type: 'schedule', title: 'Schedule a post' }), settings())).toBe('publishing');
    expect(actionConfirmationReason(card({ type: 'apply', title: 'Publish homepage' }), settings())).toBe('publishing');
    expect(actionConfirmationReason(card({ type: 'create_draft', title: 'Send a win-back email' }), settings())).toBe('sending');
    expect(actionConfirmationReason(card({ type: 'edit', title: 'Update price' }), settings())).toBe('sensitive');
    expect(actionConfirmationReason(card(), settings())).toBeNull();
  });

  it('skips the confirmation when the matching toggle is off', () => {
    expect(actionConfirmationReason(card({ type: 'edit', isDestructive: true, title: 'Delete product' }), none)).toBeNull();
    expect(actionConfirmationReason(card({ type: 'schedule', title: 'Schedule a post' }), none)).toBeNull();
    expect(actionConfirmationReason(card({ type: 'create_draft', title: 'Send email' }), none)).toBeNull();
    expect(actionConfirmationReason(card({ type: 'edit', title: 'Update price' }), none)).toBeNull();
  });

  it('honors a confirmation the server stamped even if the device cache is behind', () => {
    expect(actionConfirmationReason(card({ requiresConfirmation: true }), none)).toBe('sensitive');
  });

  it('keeps the original irreversible copy for destructive actions', () => {
    expect(confirmationCopy('destructive', 'Delete product').message).toMatch(/irreversible/);
    expect(confirmationCopy('sending', 'Email VIPs').heading).toBe('Confirm sending');
  });
});

describe('suggestionCategoryAllowed', () => {
  it('blocks all suggestions when the assistant or suggestions are off', () => {
    expect(suggestionCategoryAllowed('orders', settings({ enabled: false }))).toBe(false);
    expect(suggestionCategoryAllowed('orders', settings({ suggestionsEnabled: false }))).toBe(false);
  });

  it('blocks the categories of disabled data sources', () => {
    expect(suggestionCategoryAllowed('customers', settings({}, { customers: false }))).toBe(false);
    expect(suggestionCategoryAllowed('production', settings({}, { manufacturers: false }))).toBe(false);
    expect(suggestionCategoryAllowed('orders', settings({}, { customers: false }))).toBe(true);
  });
});

describe('AI disabled error', () => {
  it('is recognisable by name', () => {
    expect(isAIDisabledError(aiDisabledError())).toBe(true);
    expect(isAIDisabledError(new Error('x'))).toBe(false);
    expect(isAIDisabledError(null)).toBe(false);
  });
});

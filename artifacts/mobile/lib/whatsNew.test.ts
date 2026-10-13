import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));

import { whatsNewDecision } from './whatsNew';
import { WHATS_NEW } from '@/content/whatsNew';

const notes = { id: '1.2.0', items: [{ icon: 'star' as const, title: 'A', body: 'B' }] };

describe('whatsNewDecision', () => {
  it('records silently on a fresh install', () => {
    expect(whatsNewDecision(null, notes)).toBe('record-silently');
  });

  it('shows once after an update', () => {
    expect(whatsNewDecision('1.1.0', notes)).toBe('show');
    expect(whatsNewDecision('1.2.0', notes)).toBe('nothing');
  });

  it('shows nothing when a release has no notes', () => {
    expect(whatsNewDecision('1.1.0', { id: '1.2.0', items: [] })).toBe('nothing');
    expect(whatsNewDecision('1.1.0', { id: '', items: notes.items })).toBe('nothing');
  });

  it('keeps the shipped notes short', () => {
    expect(WHATS_NEW.items.length).toBeGreaterThan(0);
    expect(WHATS_NEW.items.length).toBeLessThanOrEqual(5);
    for (const item of WHATS_NEW.items) {
      expect(item.title.length).toBeLessThanOrEqual(28);
      expect(item.body.length).toBeLessThanOrEqual(90);
    }
  });
});

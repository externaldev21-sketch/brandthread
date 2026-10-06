import { describe, expect, it } from 'vitest';
import { inboxPillColors } from '@/components/inbox/InboxPillRow';
import { DEFAULT_THEME } from '@/contexts/AppThemeContext';

describe('inboxPillColors', () => {
  it('fills the ACTIVE pill (visible against the monochrome background)', () => {
    const active = inboxPillColors(DEFAULT_THEME, true);
    expect(active.backgroundColor).toBe(DEFAULT_THEME.accent);
    expect(active.backgroundColor).not.toBe(DEFAULT_THEME.background);
    expect(active.label).toBe(DEFAULT_THEME.onAccent);
  });
  it('keeps inactive pills outlined and transparent', () => {
    const inactive = inboxPillColors(DEFAULT_THEME, false);
    expect(inactive.backgroundColor).toBe('transparent');
    expect(inactive.borderColor).toBe(DEFAULT_THEME.border);
  });
});

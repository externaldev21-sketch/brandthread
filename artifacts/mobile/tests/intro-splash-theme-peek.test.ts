import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: null }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ auth: { me: vi.fn(), updateProfile: vi.fn() } }) }));
vi.mock('react-native', () => ({ Platform: { OS: 'native' } }));

import { DEFAULT_THEME, peekPersistedTheme } from '@/contexts/AppThemeContext';

function fakeStorage(store: Record<string, string> = {}) {
  return {
    getItem: async (key: string) => (key in store ? store[key] : null),
    getAllKeys: async () => Object.keys(store),
  };
}

describe('peekPersistedTheme', () => {
  it('falls back to the default theme when nothing is stored', async () => {
    const theme = await peekPersistedTheme(fakeStorage());
    expect(theme.id).toBe(DEFAULT_THEME.id);
  });

  it('resolves a signed-in user\'s persisted theme without needing their id upfront', async () => {
    const theme = await peekPersistedTheme(
      fakeStorage({ '@brandthread/app-theme:v1:user_123': 'navy' }),
    );
    expect(theme.id).toBe('navy');
  });

  it('falls back to the guest key when no user key exists', async () => {
    const theme = await peekPersistedTheme(
      fakeStorage({ '@brandthread/app-theme:v1:guest': 'gold' }),
    );
    expect(theme.id).toBe('gold');
  });

  it('ignores unrelated storage keys and invalid values', async () => {
    const theme = await peekPersistedTheme(
      fakeStorage({ 'some:other:key': 'navy', '@brandthread/app-theme:v1:guest': 'not-a-real-theme' }),
    );
    expect(theme.id).toBe(DEFAULT_THEME.id);
  });

  it('falls back to the default theme when storage throws', async () => {
    const theme = await peekPersistedTheme({
      getItem: async () => {
        throw new Error('boom');
      },
    });
    expect(theme.id).toBe(DEFAULT_THEME.id);
  });
});

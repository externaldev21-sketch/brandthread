import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));

import {
  appLanguageStorageKey,
  isAppUiTranslated,
  normalizeAppLanguage,
  readLocalAppLanguage,
  untranslatedNotice,
  writeLocalAppLanguage,
} from './appLanguage';

describe('appLanguage', () => {
  it('treats only English as a translated app language', () => {
    expect(isAppUiTranslated('en')).toBe(true);
    expect(isAppUiTranslated('en-US')).toBe(true);
    expect(isAppUiTranslated('es')).toBe(false);
    expect(untranslatedNotice('es')).toMatch(/Spanish.*isn't translated yet/);
  });
  it('normalizes unknown and regional codes', () => {
    expect(normalizeAppLanguage('pt-BR')).toBe('pt');
    expect(normalizeAppLanguage('xx')).toBe('en');
    expect(normalizeAppLanguage(42)).toBe('en');
  });
  it('stores the preference per user', async () => {
    await writeLocalAppLanguage('user_1', 'fr');
    expect(store.get(appLanguageStorageKey('user_1'))).toBe('fr');
    expect(await readLocalAppLanguage('user_1')).toBe('fr');
    expect(await readLocalAppLanguage('user_2')).toBeNull();
  });
});

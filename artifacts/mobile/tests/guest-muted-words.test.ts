import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => { store[key] = value; },
  },
}));

import {
  addGuestMutedWord, matchesGuestMutedWords, readGuestMutedWords, removeGuestMutedWord,
} from '@/lib/guestMutedWords';

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('unsigned muted words', () => {
  it('saves, deduplicates, removes and reloads on the same device', async () => {
    await addGuestMutedWord('  SpOilers  ');
    await addGuestMutedWord('spoilers');
    expect((await readGuestMutedWords()).map((word) => word.phrase)).toEqual(['spoilers']);
    await removeGuestMutedWord('spoilers');
    expect(await readGuestMutedWords()).toEqual([]);
  });

  it('serializes rapid additions without losing a word', async () => {
    await Promise.all([addGuestMutedWord('one'), addGuestMutedWord('two')]);
    expect((await readGuestMutedWords()).map((word) => word.phrase)).toEqual(['one', 'two']);
  });

  it('rejects invalid words and matches whole words, accents, hashtags and handles', async () => {
    await expect(addGuestMutedWord('###')).rejects.toThrow();
    expect(matchesGuestMutedWords('party photos', ['art'])).toBe(false);
    expect(matchesGuestMutedWords('ART drop', ['art'])).toBe(true);
    expect(matchesGuestMutedWords('Café #fyp @someone', ['cafe'])).toBe(true);
    expect(matchesGuestMutedWords('Café #fyp @someone', ['#fyp'])).toBe(true);
    expect(matchesGuestMutedWords('Café #fyp @someone', ['@someone'])).toBe(true);
  });

  it('reports an unreadable saved list instead of silently dropping it', async () => {
    store['@brandthread:guest-muted-words:v1'] = '{not json';
    await expect(readGuestMutedWords()).rejects.toThrow();
    store['@brandthread:guest-muted-words:v1'] = JSON.stringify([{ phrase: 1 }]);
    await expect(readGuestMutedWords()).rejects.toThrow('Could not read');
  });
});

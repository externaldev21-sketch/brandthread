import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MutedWord } from './safetyTypes';

// Guest preferences stay on this device. Signed-in preferences remain on the
// account API so one guest cannot edit another account's server-side filters.
const STORAGE_KEY = '@brandthread:guest-muted-words:v1';
export const GUEST_MUTED_WORD_LIMIT = 200;
const MAX_LENGTH = 60;

function normalize(text: string): string {
  return text.normalize('NFKC').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[*_~`\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeGuestMutedPhrase(raw: string): string | null {
  const phrase = normalize(raw);
  return phrase.length > 0 && phrase.length <= MAX_LENGTH && /[\p{L}\p{N}]/u.test(phrase)
    ? phrase
    : null;
}

export function matchesGuestMutedWords(text: string | null | undefined, phrases: readonly string[]): boolean {
  if (!text || !phrases.length) return false;
  const haystack = normalize(text);
  return phrases.some((phrase) => new RegExp(
    `(^|[^\\p{L}\\p{N}_])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}_])`,
    'u',
  ).test(haystack));
}

export async function readGuestMutedWords(): Promise<MutedWord[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(
    (row) => row && typeof row.phrase === 'string' && typeof row.createdAt === 'string',
  )) throw new Error('Could not read muted words saved on this device.');
  return parsed as MutedWord[];
}

// Serialize rapid taps so an earlier write cannot overwrite a later one.
let lastWrite: Promise<void> = Promise.resolve();
function updateGuestMutedWords(change: (words: MutedWord[]) => MutedWord[]): Promise<MutedWord[]> {
  const operation = lastWrite.then(async () => {
    const next = change(await readGuestMutedWords());
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
  lastWrite = operation.then(() => {}, () => {});
  return operation;
}

export function addGuestMutedWord(raw: string): Promise<MutedWord[]> {
  const phrase = normalizeGuestMutedPhrase(raw);
  if (!phrase) return Promise.reject(new Error('Enter a word or phrase of up to 60 characters.'));
  return updateGuestMutedWords((words) => {
    if (words.some((word) => word.phrase === phrase)) return words;
    if (words.length >= GUEST_MUTED_WORD_LIMIT) throw new Error('You have reached the muted words limit.');
    return [...words, { phrase, createdAt: new Date().toISOString() }]
      .sort((a, b) => a.phrase.localeCompare(b.phrase));
  });
}

export function removeGuestMutedWord(phrase: string): Promise<MutedWord[]> {
  return updateGuestMutedWords((words) => words.filter((word) => word.phrase !== phrase));
}
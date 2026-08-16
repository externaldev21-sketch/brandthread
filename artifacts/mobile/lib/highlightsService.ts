/**
 * Story Highlights — persistent CRUD via AsyncStorage.
 * Each highlight holds a display emoji, label, and cover colour.
 * The list is ordered as stored (drag-to-reorder writes the new order back).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bt:highlights:v1';

export interface Highlight {
  id: string;
  emoji: string;
  label: string;
  coverColor: string;   // hex — shown as solid ring
  createdAt: string;    // ISO
}

function uid() {
  return 'hl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function loadHighlights(): Promise<Highlight[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveHighlights(items: Highlight[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function createHighlight(params: {
  emoji: string;
  label: string;
  coverColor: string;
}): Promise<Highlight> {
  const item: Highlight = {
    id: uid(),
    emoji: params.emoji.trim() || '✨',
    label: params.label.trim() || 'Highlight',
    coverColor: params.coverColor,
    createdAt: new Date().toISOString(),
  };
  const existing = await loadHighlights();
  await saveHighlights([...existing, item]);
  return item;
}

export async function updateHighlight(
  id: string,
  patch: Partial<Pick<Highlight, 'emoji' | 'label' | 'coverColor'>>,
): Promise<void> {
  const items = await loadHighlights();
  const updated = items.map(h => (h.id === id ? { ...h, ...patch } : h));
  await saveHighlights(updated);
}

export async function deleteHighlight(id: string): Promise<void> {
  const items = await loadHighlights();
  await saveHighlights(items.filter(h => h.id !== id));
}

export async function reorderHighlights(ids: string[]): Promise<void> {
  const items = await loadHighlights();
  const map = new Map(items.map(h => [h.id, h]));
  const ordered = ids.map(id => map.get(id)).filter(Boolean) as Highlight[];
  await saveHighlights(ordered);
}

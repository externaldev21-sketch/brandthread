/**
 * useBrushLibrary — the Design Studio's brush library state (sets + brushes)
 * and the brush currently chosen for each tool, persisted on device so a
 * new set, a renamed set or a duplicated brush survives reopening the app.
 *
 * Paint, Smudge and Erase each remember their own brush, like Procreate
 * (tap the active tool's icon to open the library for that tool).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  defaultBrushLibrary, normalizeBrushLibrary, type BrushLibraryState,
} from '@/lib/paint/brushLibrary';
import {
  DEFAULT_ERASER_BRUSH_ID, DEFAULT_PAINT_BRUSH_ID, DEFAULT_SMUDGE_BRUSH_ID, findPreset, type BrushPreset,
} from '@/lib/paint/brushPresets';

export type PaintTool = 'brush' | 'smudge' | 'eraser';

const STORAGE_KEY = 'design.brushLibrary.v2';

interface Persisted extends BrushLibraryState {
  tools?: Record<PaintTool, string>;
}

const DEFAULT_TOOLS: Record<PaintTool, string> = {
  brush: DEFAULT_PAINT_BRUSH_ID,
  smudge: DEFAULT_SMUDGE_BRUSH_ID,
  eraser: DEFAULT_ERASER_BRUSH_ID,
};

export function useBrushLibrary() {
  const [library, setLibrary] = useState<BrushLibraryState>(defaultBrushLibrary);
  const [tools, setTools] = useState<Record<PaintTool, string>>(DEFAULT_TOOLS);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as Persisted;
        setLibrary(normalizeBrushLibrary(parsed));
        if (parsed.tools) setTools({ ...DEFAULT_TOOLS, ...parsed.tools });
      } catch { /* corrupt → defaults */ }
    }).catch(() => {}).finally(() => { loaded.current = true; });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const payload: Persisted = { ...library, tools };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
  }, [library, tools]);

  const brushFor = useCallback((tool: PaintTool): BrushPreset => findPreset(library.brushes, tools[tool]), [library, tools]);
  const setToolBrush = useCallback((tool: PaintTool, id: string) => setTools(t => ({ ...t, [tool]: id })), []);

  return { library, setLibrary, tools, brushFor, setToolBrush };
}

/**
 * Design editor draft + undo / redo history (app/store-design.tsx). Pure so
 * it is unit tested.
 */
import type { ButtonStyle, StoreSiteFont } from '@/lib/storeSiteDesign';

export type PickedImage = { uri: string; mimeType?: string | null };

export interface DesignDraft {
  displayName: string;
  bio: string;
  siteTheme: string;
  buttonStyle: ButtonStyle;
  font: StoreSiteFont;
  showBanner: boolean;
  /** A newly picked logo / banner (uploaded on Save), else the current image URL. */
  logo: PickedImage | null;
  banner: PickedImage | null;
  logoChanged: boolean;
  bannerChanged: boolean;
}

/** Undo / redo over whole drafts (Linktree's header arrows). Pure, unit tested. */
export interface DraftHistory { draft: DesignDraft | null; past: DesignDraft[]; future: DesignDraft[] }
export type DraftAction =
  | { type: 'reset'; draft: DesignDraft }
  /** A discrete change: one undo step. */
  | { type: 'commit'; patch: Partial<DesignDraft> }
  /** Typing: changes the draft without a new undo step (taken by 'checkpoint' on focus). */
  | { type: 'type'; patch: Partial<DesignDraft> }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' };

export function draftHistoryReducer(h: DraftHistory, a: DraftAction): DraftHistory {
  switch (a.type) {
    case 'reset': return { draft: a.draft, past: [], future: [] };
    case 'commit': return h.draft ? { draft: { ...h.draft, ...a.patch }, past: [...h.past, h.draft], future: [] } : h;
    case 'type': return h.draft ? { ...h, draft: { ...h.draft, ...a.patch } } : h;
    case 'checkpoint': return h.draft ? { ...h, past: [...h.past, h.draft], future: [] } : h;
    case 'undo': {
      if (!h.draft || !h.past.length) return h;
      return { draft: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.draft, ...h.future] };
    }
    case 'redo': {
      if (!h.draft || !h.future.length) return h;
      return { draft: h.future[0], past: [...h.past, h.draft], future: h.future.slice(1) };
    }
    default: return h;
  }
}


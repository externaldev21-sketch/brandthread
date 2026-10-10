import { describe, expect, it } from 'vitest';
import { draftHistoryReducer, type DesignDraft, type DraftHistory } from './storeDesignHistory';

const d: DesignDraft = {
  displayName: 'Maison', bio: '', siteTheme: 'black', buttonStyle: 'rounded', font: 'system',
  showBanner: true, logo: null, banner: null, logoChanged: false, bannerChanged: false,
};
const start = (): DraftHistory => draftHistoryReducer({ draft: null, past: [], future: [] }, { type: 'reset', draft: d });

describe('design editor undo / redo', () => {
  it('each tap is one undo step; redo replays it', () => {
    let h = start();
    h = draftHistoryReducer(h, { type: 'commit', patch: { siteTheme: 'white' } });
    h = draftHistoryReducer(h, { type: 'commit', patch: { buttonStyle: 'square' } });
    expect(h.draft).toMatchObject({ siteTheme: 'white', buttonStyle: 'square' });
    h = draftHistoryReducer(h, { type: 'undo' });
    expect(h.draft).toMatchObject({ siteTheme: 'white', buttonStyle: 'rounded' });
    h = draftHistoryReducer(h, { type: 'undo' });
    expect(h.draft).toEqual(d);
    expect(draftHistoryReducer(h, { type: 'undo' })).toBe(h); // nothing left
    h = draftHistoryReducer(h, { type: 'redo' });
    expect(h.draft?.siteTheme).toBe('white');
  });
  it('typing a field is one step, taken when the field is focused', () => {
    let h = start();
    h = draftHistoryReducer(h, { type: 'checkpoint' });
    for (const v of ['K', 'Kn', 'Knit']) h = draftHistoryReducer(h, { type: 'type', patch: { bio: v } });
    expect(h.past).toHaveLength(1);
    h = draftHistoryReducer(h, { type: 'undo' });
    expect(h.draft?.bio).toBe('');
  });
  it('a new change clears redo', () => {
    let h = start();
    h = draftHistoryReducer(h, { type: 'commit', patch: { font: 'serif' } });
    h = draftHistoryReducer(h, { type: 'undo' });
    h = draftHistoryReducer(h, { type: 'commit', patch: { font: 'mono' } });
    expect(h.future).toHaveLength(0);
    expect(draftHistoryReducer(h, { type: 'redo' })).toBe(h);
  });
});

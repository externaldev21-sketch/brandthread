import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(resolve(__dirname, '..', 'app/index.tsx'), 'utf8');

/**
 * Live verification caught this: directly loading "/seller-inbox?bt_preview=
 * seller&demo=1" redirected to the seller Dashboard instead of opening the
 * inbox. Root cause: app/index.tsx briefly mounts for ANY deep link during
 * Expo Router's client-side hydration on a full page load (see its own doc
 * comment), and schedules a 50ms timer that hard-redirects to the dashboard
 * if still "at root" by then. The timer's callback re-checked `atRoot`, but
 * that was the value CLOSED OVER when the effect was scheduled — not a live
 * read — so if the real route's resolution (and the re-render/effect-cancel
 * that depends on it) was delayed past 50ms by extra work the destination
 * route does while mounting (demo=1 seeding a demo dataset is exactly that
 * kind of extra work), the stale closure still read atRoot === true and
 * fired the wrong redirect over the real deep link.
 *
 * Fixed by reading a ref that mirrors `atRoot` on every render — updated
 * synchronously in the render body, not inside an effect — so the timer
 * callback sees the truth as of the most recent render even if the
 * cancelling effect hasn't committed yet.
 */
describe('app/index.tsx redirect-away-from-"/" timer never fires on a stale atRoot', () => {
  it('mirrors atRoot into a ref on every render, not just inside an effect', () => {
    expect(indexSource).toContain('const atRootRef = useRef(atRoot);');
    expect(indexSource).toContain('atRootRef.current = atRoot;');
    // Must be a plain render-body assignment, not tucked inside a useEffect
    // — the whole point is that it updates before any effect flush.
    const refAssignIndex = indexSource.indexOf('atRootRef.current = atRoot;');
    const precedingEffect = indexSource.lastIndexOf('useEffect(', refAssignIndex);
    expect(precedingEffect === -1 || precedingEffect < indexSource.indexOf('const atRootRef')).toBe(true);
  });

  it('the 50ms redirect timer reads the live ref, not a closed-over atRoot', () => {
    const timerBody = indexSource.slice(indexSource.indexOf('const redirect = setTimeout'));
    expect(timerBody).toContain('if (!atRootRef.current) return;');
    expect(timerBody).not.toContain('if (!atRoot) return;');
  });

  it('the effect itself still guards on the render-time atRoot before ever scheduling a timer', () => {
    const effectBody = indexSource.slice(
      indexSource.indexOf('useEffect(() => {\n    if (!rootNavigationState'),
      indexSource.indexOf('const redirect = setTimeout'),
    );
    expect(effectBody).toContain('if (!atRoot) return;');
  });
});

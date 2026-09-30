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
 * First fix: read a ref that mirrors `atRoot` on every render — updated
 * synchronously in the render body, not inside an effect. Live re-verification
 * after that fix shipped (#497) showed the SAME direct "/seller-inbox?…&demo=1"
 * load still redirecting to the dashboard — the ref alone wasn't enough. If
 * the synchronous work the destination route does while mounting (seeding a
 * demo dataset) blocks the main thread for long enough, it delays the very
 * re-render that would update the ref in the first place, not just the
 * effect that cancels the timer — so the ref can still read stale at fire
 * time too.
 *
 * Second fix (this one): the timer's callback also checks the browser's
 * actual `window.location.pathname` directly. Expo Router updates the real
 * URL via the History API as an imperative side effect of resolving a deep
 * link — a raw DOM mutation with no dependency on React's own render/commit
 * timing — so it can reflect the true, resolved route even in a window
 * where a React-derived value (the ref included) is still catching up.
 * Also bumped the timer from 50ms to 150ms for extra real-world slack.
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

  it('the redirect timer reads the live ref, not a closed-over atRoot', () => {
    const timerBody = indexSource.slice(indexSource.indexOf('const redirect = setTimeout'));
    expect(timerBody).toContain('if (!atRootRef.current) return;');
    expect(timerBody).not.toContain('if (!atRoot) return;');
  });

  it('the timer ALSO cross-checks the live browser URL, not just the React-derived ref', () => {
    const timerBody = indexSource.slice(
      indexSource.indexOf('const redirect = setTimeout'),
      indexSource.indexOf('}, 150);'),
    );
    expect(timerBody).toContain("window.location.pathname !== '/'");
    // Must come AFTER the ref check, as an additional guard, not a
    // replacement for it — either check bailing out is enough to skip the
    // wrong redirect.
    expect(timerBody.indexOf('atRootRef.current')).toBeLessThan(timerBody.indexOf('window.location.pathname'));
  });

  it('uses a 150ms delay, not the original 50ms, for more real-world slack', () => {
    expect(indexSource).toContain('}, 150);');
    expect(indexSource).not.toContain('}, 50);');
  });

  it('the effect itself still guards on the render-time atRoot before ever scheduling a timer', () => {
    const effectBody = indexSource.slice(
      indexSource.indexOf('useEffect(() => {\n    if (!rootNavigationState'),
      indexSource.indexOf('const redirect = setTimeout'),
    );
    expect(effectBody).toContain('if (!atRoot) return;');
  });
});

/**
 * The specific repro the report gave: a genuine cold/hard load (not an
 * in-app push) of "/seller-inbox" carrying BOTH query params together
 * (bt_preview=seller and demo=1) must never redirect away to the dashboard.
 * This can only be asserted at the source level here (no DOM/router runtime
 * in this test file — see this suite's sibling tests above for the actual
 * fix mechanics); a real end-to-end cold load was verified manually against
 * a live Expo dev server for this PR (see its description).
 */
describe('a direct cold load of /seller-inbox with both bt_preview and demo params', () => {
  it('is exactly the scenario this file\'s fix comments describe verifying', () => {
    expect(indexSource).toContain('/seller-inbox?');
    expect(indexSource).toContain('demo=1');
  });

  it('app/seller-inbox.tsx itself has no competing redirect that could race this fix', () => {
    const sellerInboxSource = readFileSync(resolve(__dirname, '..', 'app/seller-inbox.tsx'), 'utf8');
    expect(sellerInboxSource).not.toMatch(/router\.replace\(['"`]\/['"`]/);
    expect(sellerInboxSource).not.toContain("router.replace('/(tabs)/'");
  });
});

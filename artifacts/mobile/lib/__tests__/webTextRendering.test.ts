/**
 * Regression guard for the web focus-outline fix: injectWebFocusOutlineStyles
 * must actually append a `<style>` tag suppressing the browser's default
 * input/textarea focus ring (confirmed live as an amber/orange rectangle on
 * this sandbox's Chromium — the exact bug Dev reported on the story-reply
 * field and chat composer). app/+html.tsx LOOKS like the natural home for
 * this but is proven dead code for this project's `web.output: "single"`
 * build (see that file's own warning comment) — lib/bootstrap.ts calling
 * these injectWeb*Styles() functions is the only place that actually lands
 * in <head>, so this test exercises that real function, not a source-text
 * inspection of the (non-functional) +html.tsx file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

function makeFakeDocument() {
  const created: Array<{ id: string; textContent: string }> = [];
  const existingIds = new Set<string>();
  const head = {
    appendChild: vi.fn((style: { id: string; textContent: string }) => {
      existingIds.add(style.id);
    }),
  };
  return {
    head,
    getElementById: vi.fn((id: string) => (existingIds.has(id) ? {} : null)),
    createElement: vi.fn((_tag: string) => {
      const style = { id: '', textContent: '' };
      created.push(style);
      return style;
    }),
    _created: created,
  };
}

describe('injectWebFocusOutlineStyles', () => {
  let fakeDocument: ReturnType<typeof makeFakeDocument>;

  beforeEach(() => {
    vi.resetModules();
    fakeDocument = makeFakeDocument();
    vi.stubGlobal('document', fakeDocument);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('appends a style tag that suppresses the default input/textarea focus outline', async () => {
    const { injectWebFocusOutlineStyles } = await import('../webTextRendering');
    injectWebFocusOutlineStyles();

    expect(fakeDocument.head.appendChild).toHaveBeenCalledTimes(1);
    const style = fakeDocument._created[0];
    expect(style.id).toBe('bt-focus-outline');
    expect(style.textContent).toMatch(/input,\s*textarea\s*\{\s*outline:\s*none;/);
    expect(style.textContent).toMatch(/input:focus,\s*input:focus-visible/);
    expect(style.textContent).toMatch(/textarea:focus,\s*textarea:focus-visible/);
  });

  it('is idempotent — a second call does not append a second style tag', async () => {
    const { injectWebFocusOutlineStyles } = await import('../webTextRendering');
    injectWebFocusOutlineStyles();
    injectWebFocusOutlineStyles();

    expect(fakeDocument.head.appendChild).toHaveBeenCalledTimes(1);
  });

  it('never touches [role="button"]/[role="tab"] focus rings — only input/textarea', async () => {
    const { injectWebFocusOutlineStyles } = await import('../webTextRendering');
    injectWebFocusOutlineStyles();

    const style = fakeDocument._created[0];
    expect(style.textContent).not.toMatch(/role="button"/);
  });
});

describe('injectWebFocusOutlineStyles — native no-op', () => {
  it('does nothing when Platform.OS is not web', async () => {
    vi.resetModules();
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const fakeDocument = makeFakeDocument();
    vi.stubGlobal('document', fakeDocument);

    const { injectWebFocusOutlineStyles } = await import('../webTextRendering');
    injectWebFocusOutlineStyles();

    expect(fakeDocument.head.appendChild).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.doUnmock('react-native');
  });
});

/**
 * Regression guard for the "no visible scrollbar anywhere" fix — Dev's rule,
 * seen live as a white bar on the right edge of Discover's Brands/People
 * tabs. Same reasoning as the focus-outline test above: app/+html.tsx
 * already carries a near-identical (but merely thin, not hidden) rule that
 * is dead code for this build, so this exercises the real injector.
 */
describe('injectWebScrollbarHideStyles', () => {
  let fakeDocument: ReturnType<typeof makeFakeDocument>;

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
    fakeDocument = makeFakeDocument();
    vi.stubGlobal('document', fakeDocument);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('react-native');
  });

  it('appends a style tag that hides every scrollbar, vertical and horizontal', async () => {
    const { injectWebScrollbarHideStyles } = await import('../webTextRendering');
    injectWebScrollbarHideStyles();

    expect(fakeDocument.head.appendChild).toHaveBeenCalledTimes(1);
    const style = fakeDocument._created[0];
    expect(style.id).toBe('bt-scrollbar-hide');
    expect(style.textContent).toMatch(/scrollbar-width:\s*none/);
    expect(style.textContent).toMatch(/-ms-overflow-style:\s*none/);
    expect(style.textContent).toMatch(/::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
    expect(style.textContent).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*0/);
    expect(style.textContent).toMatch(/::-webkit-scrollbar\s*\{[^}]*height:\s*0/);
  });

  it('never sets overflow itself — only hides the scrollbar paint', async () => {
    const { injectWebScrollbarHideStyles } = await import('../webTextRendering');
    injectWebScrollbarHideStyles();

    const style = fakeDocument._created[0];
    expect(style.textContent).not.toMatch(/overflow\s*:/);
  });

  it('is idempotent — a second call does not append a second style tag', async () => {
    const { injectWebScrollbarHideStyles } = await import('../webTextRendering');
    injectWebScrollbarHideStyles();
    injectWebScrollbarHideStyles();

    expect(fakeDocument.head.appendChild).toHaveBeenCalledTimes(1);
  });

  it('does nothing when Platform.OS is not web', async () => {
    vi.resetModules();
    vi.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    const nativeDocument = makeFakeDocument();
    vi.stubGlobal('document', nativeDocument);

    const { injectWebScrollbarHideStyles } = await import('../webTextRendering');
    injectWebScrollbarHideStyles();

    expect(nativeDocument.head.appendChild).not.toHaveBeenCalled();
  });
});

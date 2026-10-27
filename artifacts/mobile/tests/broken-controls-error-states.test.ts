import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('broken controls and error-state regressions', () => {
  it('keeps manufacturer discovery controls functional and accessible', () => {
    // The hub landing's two top actions replaced the old header "+" and the
    // Discover tab's search/filter toggles (redesign: find-by-category).
    const hub = read('app/manufacturer-hub.tsx');
    const find = read('app/manufacturer-find.tsx');
    const results = read('app/manufacturer-category.tsx');

    for (const source of [hub, find, results]) expect(source).not.toContain('onPress={() => {}}');
    expect(hub).toContain('label="Find a manufacturer"');
    expect(hub).toContain("label=\"Invite your factory\" icon=\"user-plus\" variant=\"secondary\" fullWidth onPress={() => router.push('/invite-manufacturer' as never)}");
    // Search is a labelled field on both find screens (SearchBar announces its placeholder).
    expect(find).toContain('<SearchBar value={query} onChange={setQuery} placeholder="Search manufacturers or categories"');
    expect(results).toContain('<SearchBar value={query} onChange={onSearch}');
    // An empty category still offers the invite flow.
    expect(results).toContain("action={{ label: 'Invite your factory', onPress: () => router.push('/invite-manufacturer' as never) }}");
  });

  it('does not render unimplemented create-post tools', () => {
    const source = read('components/create-post/SlideEditor.tsx');
    expect(read('app/create-post.tsx')).toContain('<SlideEditor');
    const toolbar = source;

    expect(toolbar).not.toContain('icon="settings"');
    expect(toolbar).not.toContain('icon="sliders"');
    expect(toolbar).not.toContain('icon="film"');
    expect(toolbar).toContain('onAspect(a)');
    expect(toolbar).toContain('testID={`aspect-${a.replace');
    expect(toolbar).toContain('label="Delete"');
    expect(toolbar).toContain('slides.filter((sl) => sl.id !== active.id)');
    expect(toolbar).toContain('onSlides(next)');
  });

  it('separates address load failures from a genuinely empty account', () => {
    const source = read('app/buyer-addresses.tsx');

    expect(source).toContain("const [loadError, setLoadError] = useState('')");
    expect(source).toContain('Addresses unavailable');
    expect(source).toContain('Retry loading saved addresses');
    expect(source).toContain("You haven't saved any addresses yet.");
    expect(source).not.toContain('catch {\\n      setAddresses([]);');
  });
});
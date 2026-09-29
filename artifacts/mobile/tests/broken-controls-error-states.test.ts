import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('broken controls and error-state regressions', () => {
  it('keeps manufacturer discovery controls functional and accessible', () => {
    const source = read('app/manufacturer-hub.tsx');

    expect(source).not.toContain('onPress={() => {}}');
    expect(source).toContain("accessibilityLabel={searchActive ? 'Close manufacturer search' : 'Search manufacturers'}");
    expect(source).toContain('accessibilityLabel="Filter manufacturers"');
    expect(source).toContain("onPress: () => router.push('/invite-manufacturer'");
    expect(source).toContain("accessibilityLabel: 'Invite a manufacturer'");
  });

  it('does not render unimplemented create-post tools', () => {
    const source = read('app/create-post.tsx');
    const toolbar = source.slice(
      source.indexOf('{/* Right floating toolbar */}'),
      source.indexOf('{/* Overlay canvas'),
    );

    expect(toolbar).not.toContain('icon="settings"');
    expect(toolbar).not.toContain('icon="sliders"');
    expect(toolbar).not.toContain('icon="film"');
    expect(toolbar).toContain('accessibilityLabel="Add text overlay"');
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
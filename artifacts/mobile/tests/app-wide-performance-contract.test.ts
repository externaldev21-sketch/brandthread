import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
describe('app-wide navigation work stays bounded', () => {
  it('isolates static screen registration from route observers', () => {
    const root = read('app/_layout.tsx');
    expect(root).toContain('<AppStack />');
    expect(root).toContain('const AppStack = React.memo(function AppStack()');
    expect(root).toContain('const navigationTheme = React.useMemo(');
  });
  it.each(['(tabs)', '(buyer)'])('does not animate invisible web tab transitions in %s', group => {
    const source = read(`app/${group}/_layout.tsx`);
    expect(source).toContain("animation: Platform.OS === 'web' ? 'none' : undefined");
    expect(source).toContain("transitionSpec: Platform.OS === 'web' ? undefined");
    expect(source).toContain("if (Platform.OS !== 'web') settled.unsettle()");
    expect(source).toContain('freezeOnBlur: true');
  });
  it('shared infinite loading loops do not hold list-rendering interactions', () => {
    const ui = read('components/BrandthreadUI.tsx');
    expect(ui.match(/useFocusedAnimationLoop\(\(\) => Animated.loop/g)).toHaveLength(3);
    expect(ui.match(/isInteraction: false/g)).toHaveLength(6);
    expect(ui).toContain('return previous;');
  });
  it('does not broadcast unchanged cookie context values on every route', () => {
    const source = read('contexts/CookieConsentContext.tsx');
    expect(source).toContain('const value = useMemo(');
    expect(source).toContain('<Context.Provider value={value}>');
  });
  it('isolates runtime hosts from route observers and mounts only one context menu', () => {
    const root = read('app/_layout.tsx');
    expect(root).toContain('const RootLayoutRuntime = React.memo(');
    expect(root.match(/<ContextMenuHost\s*\/>/g)).toHaveLength(1);
    const role = read('contexts/RoleContext.tsx');
    expect(role).toContain('const setRole = useCallback(');
    expect(role).toContain('const value = useMemo(');
  });
  it('virtualizes customer rows without measuring the whole dataset', () => {
    const source = read('app/customers.tsx');
    expect(source).toContain('<FlashList');
    expect(source).toContain('const CustomerRow = React.memo(');
    expect(source).toContain('scrollToIndex({ index: row');
    expect(source).not.toContain('sortedCustomers.map((c, i)');
  });
});

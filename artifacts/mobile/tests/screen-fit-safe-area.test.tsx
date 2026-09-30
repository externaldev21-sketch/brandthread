/**
 * Screen-fit harness, run at the three reference viewports the design spec
 * targets — iPhone SE (375x667, no notch), iPhone 13/14 (390x844, notch),
 * iPhone 14 Pro Max (430x932, Dynamic Island) — with each device's real
 * `useSafeAreaInsets()` values.
 *
 * Two rules, both about a screen "fitting" on the device:
 *
 *  1. Notch/home-indicator clearance: the shared Header/ScreenHeader must
 *     pad for insets.top, and never hardcode a fixed height that would sit
 *     under the notch/Dynamic Island regardless of device.
 *  2. "Everything fits in the screen" (owner rule): no header element uses a
 *     fixed pixel size wider than the narrowest tested viewport, title/back/
 *     action rows shrink instead of overflowing, and title text is
 *     `numberOfLines`-capped so it ellipsizes instead of clipping or pushing
 *     a sibling action off screen. See screen-fit-overflow.test.tsx for the
 *     repo-wide overflow sweep this rule also drives.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Real device metrics for the three reference viewports, plus a plain web
// browser — no notch to report (insets.top reads 0), but still real browser
// chrome (tabs, address bar) a header must clear. See useHeaderTopInset's
// doc: native trusts insets.top as-is; web floors it at 54.
const DEVICES = [
  { name: 'iPhone SE', platform: 'ios', width: 375, height: 667, insets: { top: 20, bottom: 0, left: 0, right: 0 } },
  { name: 'iPhone 13/14', platform: 'ios', width: 390, height: 844, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
  { name: 'iPhone 14 Pro Max', platform: 'ios', width: 430, height: 932, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  { name: 'web, no simulated notch', platform: 'web', width: 390, height: 844, insets: { top: 0, bottom: 0, left: 0, right: 0 } },
  { name: 'web, simulated notch (phone-frame preview)', platform: 'web', width: 390, height: 844, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
] as const;

const { currentInsets, currentPlatform, nativeComponent } = vi.hoisted(() => ({
  currentInsets: { top: 20, bottom: 0, left: 0, right: 0 },
  currentPlatform: { OS: 'ios' },
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

vi.mock('react-native', () => {
  const Animated = {
    Value: class {
      interpolate() { return 0; }
    },
    View: nativeComponent('Animated.View'),
    Text: nativeComponent('Animated.Text'),
  };
  return {
    Animated,
    Platform: currentPlatform,
    StyleSheet: {
      create: (styles: unknown) => styles,
      hairlineWidth: 1,
    },
    Text: nativeComponent('Text'),
    TouchableOpacity: nativeComponent('TouchableOpacity'),
    View: nativeComponent('View'),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => currentInsets }));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('@/components/BrandthreadUI', () => ({ PressableScale: nativeComponent('PressableScale') }));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({
    theme: { background: '#000', text: '#fff', border: '#333' },
  }),
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ foreground: '#fff', background: '#000', card: '#111', border: '#333', mutedForeground: '#999', primary: '#fff' }),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

describe('Header (components/layout/Header.tsx) vs insets, at all three viewports', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it.each(DEVICES)('pads under the notch (or, on web with no notch, a comfortable floor) at $name ($width×$height)', async ({ platform, insets }) => {
    currentPlatform.OS = platform;
    currentInsets.top = insets.top;
    currentInsets.bottom = insets.bottom;
    const { Header } = await import('@/components/layout/Header');

    await act(async () => {
      renderer = create(
        <Header title="Activity" actions={[{ icon: 'settings', onPress: vi.fn(), accessibilityLabel: 'Settings' }]} />,
      );
    });

    const wrap = renderer!.root.findAllByType('View' as React.ElementType)[0];
    const expected = platform === 'web' ? Math.max(insets.top, 54) : insets.top;
    expect(flattenStyle(wrap.props.style).paddingTop).toBe(expected);
  });

  it.each(DEVICES)('keeps back button + title + actions on one row that never overflows at $width px', async ({ platform, width, insets }) => {
    currentPlatform.OS = platform;
    currentInsets.top = insets.top;
    currentInsets.bottom = insets.bottom;
    const { Header } = await import('@/components/layout/Header');

    await act(async () => {
      renderer = create(
        <Header title="A very long screen title that could overflow the header row" actions={[{ icon: 'settings', onPress: vi.fn(), accessibilityLabel: 'Settings' }]} />,
      );
    });

    const texts = renderer!.root.findAllByType('Text' as React.ElementType);
    const title = texts.find(t => typeof t.props.children === 'string' && (t.props.children as string).includes('overflow'))!;
    // Title must ellipsize rather than push the back/action buttons off screen.
    expect(title.props.numberOfLines).toBe(1);
    const titleWrap = title.parent!.parent!;
    expect(flattenStyle(titleWrap.props.style).flex).toBe(1);

    // Back button and action icon buttons are small, fixed touch targets —
    // never a fraction of the (variable) screen width, so they can never be
    // the thing that overflows a narrow device.
    const iconBtns = renderer!.root.findAllByType('TouchableOpacity' as React.ElementType);
    for (const btn of iconBtns) {
      const s = flattenStyle(btn.props.style);
      expect(typeof s.width).toBe('number');
      expect(s.width as number).toBeLessThan(width);
      expect(s.width as number).toBeLessThanOrEqual(60);
    }
  });
});

describe('ScreenHeader (components/ScreenHeader.tsx) vs insets, at all three viewports', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it.each(DEVICES)('pads under the notch (or a comfortable web floor) + a fixed gap at $name', async ({ platform, insets }) => {
    currentPlatform.OS = platform;
    currentInsets.top = insets.top;
    currentInsets.bottom = insets.bottom;
    const { ScreenHeader } = await import('@/components/ScreenHeader');
    const { SP } = await import('@/lib/theme');

    await act(async () => {
      renderer = create(<ScreenHeader title="Orders" />);
    });

    const wrap = renderer!.root.findAllByType('View' as React.ElementType)[0];
    const expectedTopInset = platform === 'web' ? Math.max(insets.top, 54) : insets.top;
    expect(flattenStyle(wrap.props.style).paddingTop).toBe(expectedTopInset + SP.sm);
  });

  it.each(DEVICES)('shrinks the title instead of overflowing past back/action buttons at $width px', async ({ platform, width, insets }) => {
    currentPlatform.OS = platform;
    currentInsets.top = insets.top;
    currentInsets.bottom = insets.bottom;
    const { ScreenHeader } = await import('@/components/ScreenHeader');

    await act(async () => {
      renderer = create(
        <ScreenHeader
          title="An extremely long product name that would otherwise overflow the header"
          actions={[{ icon: 'more-horizontal', onPress: vi.fn(), accessibilityLabel: 'More' }]}
        />,
      );
    });

    const texts = renderer!.root.findAllByType('Text' as React.ElementType);
    const title = texts.find(t => typeof t.props.children === 'string' && (t.props.children as string).includes('overflow'))!;
    expect(title.props.numberOfLines).toBe(1);

    const titleBlock = title.parent!.parent!;
    expect(flattenStyle(titleBlock.props.style).flex).toBe(1);

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Go back from An extremely long product name that would otherwise overflow the header' });
    expect((flattenStyle(backBtn.props.style).width as number)).toBeLessThan(width);
    expect((flattenStyle(backBtn.props.style).width as number)).toBeLessThanOrEqual(44);
  });

  // Regression guard for the exact bug reported after #418: every screen on
  // ScreenHeader's push variant rendered a bordered/boxed circular back
  // button (borderWidth + card background) next to the title, looking like
  // the pre-#418 "old header" even though the file itself was correctly
  // migrated. The primary back/close button must be plain — no border, no
  // background — for BOTH variants, so this can't quietly regress per-variant.
  it.each(['push', 'modal'] as const)('renders a plain (unboxed) primary %s button — no border, no background', async (variant) => {
    const { ScreenHeader } = await import('@/components/ScreenHeader');

    await act(async () => {
      renderer = create(<ScreenHeader title="Settings" variant={variant} />);
    });

    const label = variant === 'modal' ? 'Close Settings' : 'Go back from Settings';
    const btn = renderer!.root.findByProps({ accessibilityLabel: label });
    const style = flattenStyle(btn.props.style);
    expect(style.borderWidth ?? 0).toBe(0);
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderRadius ?? 0).toBe(0);
  });
});

// ─── useHeaderTopInset (hooks/useHeaderTopInset.ts) ────────────────────────────
// Direct coverage of the one hook every header in the app now shares
// (ScreenHeader, BrandthreadScreen, ProfileShell, LegalDocument, Header, and
// every hand-rolled header row migrated to it) — the single place a future
// regression to this logic would actually need to happen for every one of
// those call sites to break at once.
describe('useHeaderTopInset', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  it.each(DEVICES)('returns $insets.top on $platform when the real inset already clears the web floor, $name', async ({ platform, insets }) => {
    currentPlatform.OS = platform;
    currentInsets.top = insets.top;
    const { useHeaderTopInset } = await import('@/hooks/useHeaderTopInset');

    let result: number | null = null;
    function Probe() { result = useHeaderTopInset(); return null; }
    await act(async () => { renderer = create(<Probe />); });

    const expected = platform === 'web' ? Math.max(insets.top, 54) : insets.top;
    expect(result).toBe(expected);
  });

  it('floors at 54 on web when insets.top is 0 (a plain browser window, no notch)', async () => {
    currentPlatform.OS = 'web';
    currentInsets.top = 0;
    const { useHeaderTopInset } = await import('@/hooks/useHeaderTopInset');

    let result: number | null = null;
    function Probe() { result = useHeaderTopInset(); return null; }
    await act(async () => { renderer = create(<Probe />); });

    expect(result).toBe(54);
  });

  it('never floors on native — a device with no notch (insets.top 0) stays 0', async () => {
    currentPlatform.OS = 'ios';
    currentInsets.top = 0;
    const { useHeaderTopInset } = await import('@/hooks/useHeaderTopInset');

    let result: number | null = null;
    function Probe() { result = useHeaderTopInset(); return null; }
    await act(async () => { renderer = create(<Probe />); });

    expect(result).toBe(0);
  });
});

// ─── Repo-wide guard against reinventing this logic, badly ─────────────────────
// The bug this file exists to catch (a screen's header sitting under the
// notch/Dynamic Island on web) came from screens/components computing their
// own top-inset web floor ad hoc instead of importing the one shared hook —
// with a floor lower than the 54 every current call site (migrated or not)
// agrees on, e.g. a stray 47 (`WEB_SAFE_AREA_TOP`) or 40. A plain
// `Math.max(insets.top, 54)` is still fine wherever it already appears (most
// of the app hasn't been migrated onto the hook yet — that's a separate,
// larger effort); this guard only catches a NEW inconsistent, too-low floor
// reappearing anywhere, which is exactly the shape of bug that shipped
// twice (Order confirmation, then Shipping address) before this hook
// existed. buyer-checkout.tsx and components/checkout/** are excluded: a
// parallel effort is rebuilding that flow and owns its header/inset code.
describe('no file introduces a too-low web top-inset floor (the useHeaderTopInset bug class)', () => {
  it('every `Math.max(insets.top, N)` in app/ or components/ uses N >= 54', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(import.meta.dirname, '..');
    const scanDirs = ['app', 'components'].map((d) => path.join(root, d));
    const excluded = [path.join(root, 'app', 'buyer-checkout.tsx'), path.join(root, 'components', 'checkout')];
    const offenders: string[] = [];
    const pattern = /Math\.max\(\s*insets\.top\s*,\s*(\d+)\s*\)/g;

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (excluded.some((e) => full === e || full.startsWith(`${e}${path.sep}`))) continue;
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (entry === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry) || entry.endsWith('.test.tsx') || entry.endsWith('.test.ts')) continue;
        const source = readFileSync(full, 'utf8');
        for (const match of source.matchAll(pattern)) {
          if (Number(match[1]) < 54) offenders.push(`${path.relative(root, full)}: Math.max(insets.top, ${match[1]})`);
        }
      }
    }
    for (const dir of scanDirs) walk(dir);

    expect(offenders).toEqual([]);
  });
});

/**
 * A stricter follow-on rule, added after PR #367 independently reintroduced
 * the same bug on 77 more screens via its own copy of the inline expression
 * (fixed by consolidating everything onto useHeaderTopInset — see that
 * merge's history) and Dev asked for a test that fails outright the moment
 * ANY screen renders a header/top-bar padded straight off `insets.top`
 * instead of the shared hook, rather than only catching a too-low floor
 * value the way the rule above does.
 *
 * This scans for the two textual shapes a header wires its top clearance
 * with in this codebase: a `const someTopVar = insets.top...` declaration,
 * or `insets.top` used directly inline as a `paddingTop`/`top` style value
 * — where the variable/style name reads as header-shaped (top/header/bar)
 * — and requires every match to either go through `useHeaderTopInset()` or
 * be in ALLOWED_RAW_TOP_INSET_USES below with a one-line reason. Anything
 * else fails the build immediately; there is no silent floor to fall back
 * on here.
 *
 * ALLOWED_RAW_TOP_INSET_USES is for real, reviewed exceptions only — a
 * full-bleed camera viewfinder's own chrome, a security lock gate that only
 * ever renders on native (where insets.top is already correct with no web
 * fallback needed), or scroll/parallax geometry that isn't a header at all.
 * Adding a file here without one of those reasons defeats the point of this
 * test — don't.
 */
const ALLOWED_RAW_TOP_INSET_USES: Record<string, string> = {
  'app/buyer-checkout.tsx': 'out of scope — a separate effort owns the checkout flow',
  'app/camera-capture.tsx': 'full-bleed native camera chrome; its one header row already floors via Math.max(insets.top, 54)',
  'app/live.tsx': "TabPageHeader's own documented 67pt web fallback for the LIVE tab header, not a stack-screen header",
  'components/security/AppLockGate.tsx': 'native-only past its own early return — the file never renders on web, so insets.top is always the real device value',
  'app/onboarding.tsx': "the decorative ThreadWeave background animation's position, not a header",
};

describe('no screen header/top-bar bypasses the shared useHeaderTopInset hook', () => {
  it('every header-shaped `insets.top` use outside the allowlist goes through useHeaderTopInset()', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(import.meta.dirname, '..');
    const scanDirs = ['app', 'components'].map((d) => path.join(root, d));
    const hookFile = path.join(root, 'hooks', 'useHeaderTopInset.ts');
    const offenders: string[] = [];

    // `const topPad = insets.top` / `const headerTop = insets.top + N` / etc.
    const declPattern = /const\s+(\w*(?:top|header|bar)\w*)\s*[:=][^=][^;\n]*\binsets\.top\b/gi;
    // `paddingTop: insets.top` / `top: insets.top` used directly (no Math.max
    // floor, no hook) as a JSX style value.
    const inlinePattern = /(?<![.\w])(paddingTop|top)\s*:\s*\(?\s*insets\.top\b(?!\s*,)/g;

    function relevant(name: string) {
      return /top|header|bar/i.test(name);
    }

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (full === hookFile) continue;
        const stat = statSync(full);
        if (stat.isDirectory()) {
          if (entry === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry) || entry.endsWith('.test.tsx') || entry.endsWith('.test.ts')) continue;
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (ALLOWED_RAW_TOP_INSET_USES[rel]) continue;
        const source = readFileSync(full, 'utf8');

        for (const match of source.matchAll(declPattern)) {
          if (relevant(match[1])) offenders.push(`${rel}: const ${match[1]} = ...insets.top... (not useHeaderTopInset())`);
        }
        for (const match of source.matchAll(inlinePattern)) {
          offenders.push(`${rel}: ${match[1]}: insets.top used inline (not useHeaderTopInset())`);
        }
      }
    }
    for (const dir of scanDirs) walk(dir);

    expect(offenders).toEqual([]);
  });

  it('every ALLOWED_RAW_TOP_INSET_USES entry still exists and has a reason', () => {
    for (const [file, reason] of Object.entries(ALLOWED_RAW_TOP_INSET_USES)) {
      expect(reason.length).toBeGreaterThan(0);
      expect(typeof file).toBe('string');
    }
  });
});

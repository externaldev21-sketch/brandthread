/**
 * "Everything fits in the screen" — the owner rule behind this harness.
 * Companion to screen-fit-safe-area.test.tsx (which covers header vs.
 * insets.top/bottom); this file covers horizontal overflow at the same
 * three reference viewports (375, 390, 430).
 *
 * Real yoga/DOM layout isn't available in this Vitest (node) environment, so
 * "no element crosses the screen edge" is asserted the way this repo already
 * asserts layout elsewhere (see seller-dashboard-sections-large-text.test.tsx,
 * quick-action-card.test.tsx): render with react-test-renderer and check the
 * flex properties that make horizontal overflow structurally impossible —
 * `flex`/`minWidth: 0` on a text sibling of a row so it shrinks instead of
 * pushing its neighbor off screen, and `numberOfLines` so long text
 * ellipsizes instead of clipping — plus a repo-wide static sweep for the
 * concrete anti-patterns that cause it (fixed pixel widths wider than the
 * narrowest tested viewport, and screen-edge-pushing negative margins).
 *
 * Concretely traces back to a real bug: the Activity screen's "Suggested for
 * you" section header text could clip because its title had no dedicated
 * horizontal gutter — see the dedicated activity-center assertions below.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT_WIDTHS = [375, 390, 430] as const;
const NARROWEST_VIEWPORT = Math.min(...VIEWPORT_WIDTHS);

const { nativeComponent } = vi.hoisted(() => ({
  nativeComponent: (name: string) => {
    function MockNativeComponent(props: Record<string, unknown>) {
      return React.createElement(name, props, props.children as React.ReactNode);
    }
    MockNativeComponent.displayName = name;
    return MockNativeComponent;
  },
}));

const noopAnimation = { start: (cb?: () => void) => cb?.() };
vi.mock('react-native', () => ({
  Animated: {
    View: nativeComponent('Animated.View'),
    Value: class { interpolate() { return 0; } },
    parallel: () => noopAnimation,
    spring: () => noopAnimation,
    timing: () => noopAnimation,
  },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: nativeComponent('Text'),
  TouchableOpacity: nativeComponent('TouchableOpacity'),
  View: nativeComponent('View'),
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios },
  Pressable: function MockPressable(props: Record<string, unknown>) {
    const children = props.children;
    return React.createElement(
      'Pressable',
      props,
      typeof children === 'function' ? (children as (state: { pressed: boolean }) => React.ReactNode)({ pressed: false }) : (children as React.ReactNode),
    );
  },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  ActivityIndicator: nativeComponent('ActivityIndicator'),
  Modal: nativeComponent('Modal'),
  ScrollView: nativeComponent('ScrollView'),
  Switch: nativeComponent('Switch'),
  TextInput: nativeComponent('TextInput'),
  Image: nativeComponent('Image'),
  Keyboard: { dismiss: vi.fn() },
}));
vi.mock('@expo/vector-icons', () => ({ Feather: nativeComponent('Feather') }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: nativeComponent('LinearGradient') }));
vi.mock('react-native-svg', () => ({ default: nativeComponent('Svg'), Line: nativeComponent('SvgLine') }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(), notificationAsync: vi.fn(), selectionAsync: vi.fn(),
  ImpactFeedbackStyle: {}, NotificationFeedbackType: {},
}));
vi.mock('@/hooks/useColors', () => ({
  useColors: () => ({ foreground: '#fff', primary: '#fff' }),
}));
vi.mock('@/contexts/AppThemeContext', () => ({
  useAppTheme: () => ({ theme: { accentLight: '#fff', accent: '#fff' } }),
  getOnAccentTextStyle: () => ({}),
}));
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSelection: vi.fn() }));
vi.mock('@/components/KeyboardAwareScrollViewCompat', () => ({ KeyboardAwareScrollViewCompat: nativeComponent('KeyboardAwareScrollViewCompat') }));
vi.mock('@/lib/undoRecovery', () => ({ undoExpiresAt: () => 0 }));

function flattenStyle(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

const LONG_TITLE = 'A very long section title that would otherwise push the action button off the edge of a narrow screen';

describe('SectionHeader (components/SectionHeader.tsx) never overflows a title+action row', () => {
  let renderer: ReactTestRenderer | null = null;
  afterEach(() => { renderer?.unmount(); renderer = null; });

  it.each(VIEWPORT_WIDTHS)('shrinks the title instead of overflowing at %ipx', async () => {
    const { SectionHeader } = await import('@/components/SectionHeader');
    await act(async () => {
      renderer = create(<SectionHeader title={LONG_TITLE} action="See all" onAction={vi.fn()} />);
    });

    const texts = renderer!.root.findAllByType('Text' as React.ElementType);
    const title = texts.find(t => t.props.children === LONG_TITLE)!;
    const action = texts.find(t => t.props.children === 'See all')!;

    expect(title.props.numberOfLines).toBe(1);
    // .parent is the same-style composite wrapper the mock re-renders through;
    // .parent.parent is the real JSX parent (the titleWrap View).
    const titleWrap = title.parent!.parent!;
    expect(flattenStyle(titleWrap.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    // The action must not itself shrink away — only the title gives ground.
    expect(flattenStyle(action.parent!.parent!.props.style).flexShrink).toBe(0);
  });
});

describe('SectionHeader (components/BrandthreadUI.tsx) never overflows a title+action row', () => {
  let renderer: ReactTestRenderer | null = null;
  afterEach(() => { renderer?.unmount(); renderer = null; });

  it.each(VIEWPORT_WIDTHS)('shrinks the title instead of overflowing at %ipx', async () => {
    const { SectionHeader } = await import('@/components/BrandthreadUI');
    await act(async () => {
      renderer = create(<SectionHeader title={LONG_TITLE} action={{ label: 'See all', onPress: vi.fn() }} />);
    });

    const texts = renderer!.root.findAllByType('Text' as React.ElementType);
    const title = texts.find(t => t.props.children === LONG_TITLE)!;
    const action = texts.find(t => t.props.children === 'See all')!;

    expect(title.props.numberOfLines).toBe(1);
    const titleWrap = title.parent!.parent!;
    expect(flattenStyle(titleWrap.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(flattenStyle(action.props.style).flexShrink).toBe(0);
  });
});

describe('Activity screen "Suggested for you" section (the reported clipping bug)', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/activity-center.tsx'), 'utf8');

  it('gives the "Suggested for you" title numberOfLines + its own horizontal gutter', () => {
    const marker = source.indexOf('Suggested for you</Text>');
    expect(marker).toBeGreaterThan(-1);
    const line = source.slice(source.lastIndexOf('<Text', marker), marker);
    expect(line).toContain('numberOfLines={1}');

    // The title reuses the shared `sectionTitle` style (no horizontal
    // padding of its own) but sits in a section whose *rows* set their own
    // paddingHorizontal independently — so the title needs an explicit
    // gutter or it renders flush against both screen edges. Root cause of
    // the reported clipping.
    expect(line).toContain('suggestedTitle');
    const suggestedTitleStyle = source.slice(
      source.indexOf('suggestedTitle: {'),
      source.indexOf('}', source.indexOf('suggestedTitle: {')),
    );
    expect(suggestedTitleStyle).toContain('paddingHorizontal');
  });

  it('gives every other section header title numberOfLines too', () => {
    const headerMarker = source.indexOf('{section.title}</Text>');
    expect(headerMarker).toBeGreaterThan(-1);
    const line = source.slice(source.lastIndexOf('<Text', headerMarker), headerMarker);
    expect(line).toContain('numberOfLines={1}');
  });
});

// ─── Repo-wide static sweep ─────────────────────────────────────────────────
//
// These two checks are cheap, low-false-positive proxies for "an element
// extends past the screen edge" that a real layout engine would catch:
// nothing meant to fill the screen should hardcode a pixel width wider than
// the narrowest tested viewport (375), and no negative horizontal margin
// should be large enough to push its own content, rather than just a small
// decorative icon/dot, past the gutter.

const SCAN_ROOTS = ['app', 'components'];
const SCAN_EXTS = new Set(['.tsx', '.ts']);
// Decorative/full-bleed exceptions, checked by hand: background glows,
// off-screen carousels, etc. that are intentionally wider than the device
// (always `position: 'absolute'`, never affecting sibling/document layout).
const WIDE_FIXED_WIDTH_ALLOWLIST = new Set([
  'components/web/WebAppShell.tsx', // decorative blurred glow behind web content
  'components/ai/AuroraGlow.tsx', // decorative blob-field glow behind AI screens
]);
// A negative margin small enough to just re-center an icon/dot/caret inside
// its own touch target never reaches the screen edge.
const SAFE_NEGATIVE_MARGIN_MAGNITUDE = 20;
// Verified by hand: `position: 'absolute'` + `left/top: '50%'` + a negative
// margin of exactly half the element's own size is the standard "center an
// absolutely-positioned decorative overlay on a point" trick. It never
// affects sibling/document layout, so it can't push content off screen.
const NEGATIVE_MARGIN_ALLOWLIST = new Set([
  "app/(tabs)/feed.tsx: marginLeft: -55", // double-tap heart-burst overlay, centered via position:absolute + left:50%
]);

function listSourceFiles(root: string): string[] {
  const abs = resolve(process.cwd(), root);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        walk(full);
      } else if (SCAN_EXTS.has(extname(entry)) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
        // Screen/component source only — colocated *.test.* fixtures aren't
        // rendered UI and routinely use device-size literals as test data.
        out.push(full);
      }
    }
  };
  walk(abs);
  return out;
}

/** Pixel-width style literals inside `StyleSheet.create({...})` blocks only —
 *  a plain data object (e.g. a list of export-size presets) is not a style. */
function styleSheetBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /StyleSheet\.create\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    blocks.push(text.slice(start, i));
  }
  return blocks;
}

describe('repo-wide: nothing meant to fill the screen is wider than the narrowest tested device', () => {
  it(`has no fixed "width" style literal wider than ${NARROWEST_VIEWPORT}px outside the allow-list`, () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of listSourceFiles(root)) {
        const relPath = file.slice(resolve(process.cwd()).length + 1);
        if (WIDE_FIXED_WIDTH_ALLOWLIST.has(relPath)) continue;
        const text = readFileSync(file, 'utf8');
        for (const block of styleSheetBlocks(text)) {
          for (const match of block.matchAll(/(?<!max|min)[wW]idth:\s*(\d+)\s*,/g)) {
            const value = Number(match[1]);
            if (value > NARROWEST_VIEWPORT) {
              offenders.push(`${relPath}: width: ${value}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('repo-wide: no negative margin pushes content past the screen gutter', () => {
  it('has no negative horizontal margin larger than a small centering nudge', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of listSourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/margin(Left|Right|Horizontal)?:\s*(-\d+(?:\.\d+)?)/g)) {
          const magnitude = Math.abs(Number(match[2]));
          const offender = `${file.slice(resolve(process.cwd()).length + 1)}: margin${match[1] ?? ''}: ${match[2]}`;
          if (magnitude > SAFE_NEGATIVE_MARGIN_MAGNITUDE && !NEGATIVE_MARGIN_ALLOWLIST.has(offender)) {
            offenders.push(offender);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

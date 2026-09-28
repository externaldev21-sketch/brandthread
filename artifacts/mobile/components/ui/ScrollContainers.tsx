/**
 * Drop-in ScrollView/FlatList/SectionList with the scroll indicator OFF by
 * default — Dev's rule: no visible scrollbar/indicator anywhere, on any
 * platform.
 *
 * Web is already fully covered regardless of any component's own props:
 * react-native-web's ScrollView never reads showsVerticalScrollIndicator/
 * showsHorizontalScrollIndicator at all (it just sets CSS `overflow`), so
 * the visible "white bar" bug there is the BROWSER's own scrollbar, killed
 * globally by lib/webTextRendering.ts's injectWebScrollbarHideStyles(). Its
 * checklist verified 20 screens with zero visible scrollbars app-wide.
 *
 * These wrappers are the native-platform half: on iOS/Android the prop
 * genuinely controls the OS-drawn scroll thumb. A plain
 * `Component.defaultProps = {...}` assignment does NOT work for this — the
 * automatic JSX runtime this project builds with (`jsx`/`jsxs`, not
 * `React.createElement`) never reads `defaultProps` at all, confirmed
 * against react/cjs/react-jsx-runtime.development.js — so the fix has to be
 * a real wrapper component, not a monkeypatch.
 *
 * New/updated screens should import ScrollView/FlatList/SectionList from
 * here instead of 'react-native'. FlashList already exposes its own
 * `showsVerticalScrollIndicator`/`showsHorizontalScrollIndicator` props
 * directly (it forwards them to CellContainer's own ScrollView) — pass
 * `showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator=
 * {false}` at each FlashList call site (no separate wrapper needed there;
 * it isn't re-exported as a class/function type these wrappers can extend
 * the same way).
 *
 * This does NOT retroactively touch the ~260 existing screens that import
 * ScrollView/FlatList/SectionList straight from 'react-native' — on native,
 * those keep showing the OS's own auto-fading indicator, unchanged from
 * before this fix (never the reported bug, which is web-only). Migrating
 * every existing call site is a much larger, separate sweep.
 */
import React, { forwardRef } from 'react';
import {
  ScrollView as RNScrollView,
  FlatList as RNFlatList,
  SectionList as RNSectionList,
  type ScrollViewProps,
  type FlatListProps,
  type SectionListProps,
} from 'react-native';

const HIDDEN_INDICATORS = {
  showsVerticalScrollIndicator: false,
  showsHorizontalScrollIndicator: false,
} as const;

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>((props, ref) => (
  <RNScrollView ref={ref} {...HIDDEN_INDICATORS} {...props} />
));
ScrollView.displayName = 'ScrollView';

export const FlatList = forwardRef<RNFlatList, FlatListProps<unknown>>((props, ref) => (
  <RNFlatList ref={ref} {...HIDDEN_INDICATORS} {...props} />
)) as <ItemT>(
  props: FlatListProps<ItemT> & { ref?: React.Ref<RNFlatList<ItemT>> },
) => React.ReactElement;
(FlatList as unknown as { displayName: string }).displayName = 'FlatList';

export const SectionList = forwardRef<RNSectionList, SectionListProps<unknown>>((props, ref) => (
  <RNSectionList ref={ref} {...HIDDEN_INDICATORS} {...props} />
)) as <ItemT, SectionT = unknown>(
  props: SectionListProps<ItemT, SectionT> & { ref?: React.Ref<RNSectionList<ItemT, SectionT>> },
) => React.ReactElement;
(SectionList as unknown as { displayName: string }).displayName = 'SectionList';

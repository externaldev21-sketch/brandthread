/**
 * DesktopShell — the full-screen desktop web layout (Shopify-admin style).
 *
 * Rendered by app/_layout.tsx's RuntimeThemeShell in place of WebAppShell
 * at window widths >= DESKTOP_SHELL_BREAKPOINT (useIsDesktopWeb). A
 * persistent left sidebar (collapsible to icons with the hamburger) carries
 * every destination the phone reaches through the bottom tab bar, the Studio
 * radial menu and the More screen; sellers also get a slim top bar (jump-to
 * search, Brandthread AI, profile). Both bottom tab bars and the radial menu
 * are simply not mounted at these widths — their layouts check
 * useIsDesktopWeb() — so nothing floats over the content.
 *
 * Routes without a signed-in shell (auth, onboarding, legal) and immersive
 * full-screen flows (camera, live, canvas) render in the classic centered
 * column instead (desktopShellLayout.ts DESKTOP_SHELL_HIDDEN_SEGMENTS).
 *
 * The element tree around `children` is identical whether or not the sidebar
 * shows, so signing in, or opening a full-screen flow, never remounts the
 * navigator underneath.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useSegments } from 'expo-router';
import { useUser } from '@clerk/expo';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useRole } from '@/contexts/RoleContext';
import { useSellerShell } from '@/contexts/SellerShellContext';
import { previewSellerPersonName } from '@/lib/previewIdentity';
import { cancelStudioReturn } from '@/lib/navigation/studioReturn';
import { FONT, FS, SP } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { getActiveTab } from '@/components/SellerGlobalTabBar';
import { DesktopShellContext, type DesktopShellValue } from './DesktopShellContext';
import {
  CONTENT_GUTTER, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH, TOP_BAR_HEIGHT,
  contentMaxWidthFor, contentWidthFor, desktopShellSide, routeKey, type DesktopShellSide,
} from './desktopShellLayout';
import {
  BUYER_DESKTOP_NAV, BUYER_ROUTE_NAV_ITEM, SELLER_DESKTOP_NAV, activeNavItemId, type DesktopNavGroup, type DesktopNavItem,
} from './desktopNav';

/** The classic centered column's width (WebAppShell's WEB_SHELL_MAX_WIDTH). */
const CLASSIC_COLUMN_WIDTH = 640;
const COLLAPSED_STORAGE_KEY = 'bt:desktopSidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // Private browsing: the choice just lasts for this page load.
  }
}

/** Sidebar navigation: tab-group destinations pop back to the tab group the
 *  way the bottom bars do (docs/NAVIGATION.md rule 3), so a sidebar click
 *  from a pushed screen never stacks a second tab navigator; everything
 *  else is a normal navigation, so back and deep links keep working. */
function useNavigateTo() {
  const router = useRouter();
  const segments = useSegments() as string[];
  return React.useCallback((href: string) => {
    cancelStudioReturn();
    const group = href.startsWith('/(tabs)') ? '(tabs)' : href.startsWith('/(buyer)') ? '(buyer)' : null;
    if (group && segments[0] !== group && router.canGoBack()) router.dismissTo(href as never);
    else router.navigate(href as never);
  }, [router, segments]);
}

export function DesktopShell({
  children,
  previewRole,
}: {
  children: React.ReactNode;
  /** The web design preview / local dev bypass role, which has no Clerk session. */
  previewRole: 'buyer' | 'seller' | null;
}) {
  const { theme } = useAppTheme();
  const segments = useSegments() as string[];
  const { role } = useRole();
  const { isActiveSeller } = useSellerShell();
  const { width, height } = useWindowDimensions();
  const side = desktopShellSide({
    segments,
    isSeller: isActiveSeller || previewRole === 'seller',
    isBuyer: role === 'buyer' || previewRole === 'buyer',
  });

  const [collapsed, setCollapsed] = React.useState(readCollapsed);
  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  }, []);

  const sidebarWidth = side ? (collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH) : 0;
  const topBarHeight = side === 'seller' ? TOP_BAR_HEIGHT : 0;
  const contentWidth = side
    ? contentWidthFor({ windowWidth: width, sidebarWidth, maxWidth: contentMaxWidthFor(side, segments) })
    : Math.min(CLASSIC_COLUMN_WIDTH, width);
  const shellValue = React.useMemo<DesktopShellValue | null>(
    () => (side ? { side, contentWidth, contentHeight: height - topBarHeight } : null),
    [side, contentWidth, height, topBarHeight],
  );

  const palette = theme as typeof theme & Record<string, any>;
  const background = palette.background ?? '#0A0A0B';
  const surface = palette.surface ?? background;
  const border = palette.border ?? 'rgba(255,255,255,0.08)';

  return (
    <View style={[styles.root, { backgroundColor: background }]} testID="desktop-shell">
      {!side ? (
        <LinearGradient
          colors={[surface, background, background]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {side ? (
        <DesktopSidebar side={side} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} width={sidebarWidth} />
      ) : null}
      <View style={styles.main}>
        {side === 'seller' ? <DesktopTopBar /> : null}
        <View style={[styles.contentArea, side ? { paddingHorizontal: CONTENT_GUTTER } : null]}>
          <View
            testID={side ? 'desktop-shell-content' : 'web-app-shell-column'}
            style={[
              styles.column,
              { width: contentWidth },
              !side && [styles.classicColumn, { backgroundColor: background, borderColor: border }],
            ]}
          >
            <DesktopShellContext.Provider value={shellValue}>{children}</DesktopShellContext.Provider>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function DesktopSidebar({
  side,
  collapsed,
  onToggleCollapsed,
  width,
}: {
  side: DesktopShellSide;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  width: number;
}) {
  const { theme } = useAppTheme();
  const segments = useSegments() as string[];
  const navigateTo = useNavigateTo();
  const groups = side === 'seller' ? SELLER_DESKTOP_NAV : BUYER_DESKTOP_NAV;
  const key = routeKey(segments);
  const fallbackTab = side === 'seller'
    ? getActiveTab(segments)
    : segments[0] === '(buyer)' ? (BUYER_ROUTE_NAV_ITEM[key] ?? null) : null;
  const activeId = activeNavItemId(groups, key, fallbackTab);

  return (
    <View
      testID="desktop-sidebar"
      role="navigation"
      style={[styles.sidebar, { width, borderRightColor: theme.borderSubtle, backgroundColor: theme.background }]}
    >
      <View style={[styles.sidebarHeader, collapsed && styles.sidebarHeaderCollapsed]}>
        <Pressable
          testID="desktop-sidebar-toggle"
          accessibilityRole="button"
          accessibilityLabel={collapsed ? 'Expand menu' : 'Collapse menu'}
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggleCollapsed}
          style={(state) => [styles.iconButton, (state as { hovered?: boolean }).hovered && { backgroundColor: theme.surface }]}
        >
          <Icon name="menu" size={20} color={theme.text} />
        </Pressable>
        {!collapsed ? (
          <Text style={[styles.wordmark, { color: theme.text }]} numberOfLines={1}>Brandthread</Text>
        ) : null}
      </View>
      <ScrollView
        style={styles.sidebarScroll}
        contentContainerStyle={[styles.sidebarScrollContent, collapsed && styles.sidebarScrollContentCollapsed]}
        showsVerticalScrollIndicator={false}
      >
        {groups.map((group, index) => (
          <SidebarGroup
            key={group.title ?? `group-${index}`}
            group={group}
            first={index === 0}
            collapsed={collapsed}
            activeId={activeId}
            onSelect={(item) => navigateTo(item.href)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function SidebarGroup({
  group,
  first,
  collapsed,
  activeId,
  onSelect,
}: {
  group: DesktopNavGroup;
  first: boolean;
  collapsed: boolean;
  activeId: string | null;
  onSelect: (item: DesktopNavItem) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={!first && styles.group}>
      {group.title ? (
        collapsed ? (
          <View style={[styles.groupDivider, { backgroundColor: theme.borderSubtle }]} />
        ) : (
          <Text style={[styles.groupTitle, { color: theme.muted }]} numberOfLines={1}>{group.title}</Text>
        )
      ) : null}
      {group.items.map((item) => {
        const active = item.id === activeId;
        return (
          <Pressable
            key={item.id}
            testID={`desktop-nav-${item.id}`}
            accessibilityRole="link"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            // The web's own "you are here" marker for navigation links
            // (react-native-web renders it; RN's types don't list it yet).
            {...({ 'aria-current': active ? 'page' : undefined } as object)}
            onPress={() => onSelect(item)}
            style={(state) => [
              styles.navItem,
              collapsed && styles.navItemCollapsed,
              active
                ? { backgroundColor: theme.card }
                : (state as { hovered?: boolean }).hovered && { backgroundColor: theme.surface },
            ]}
          >
            <Icon name={item.icon} size={18} color={active ? theme.text : theme.muted} />
            {!collapsed ? (
              <Text
                style={[styles.navLabel, { color: active ? theme.text : theme.muted }, active && styles.navLabelActive]}
                numberOfLines={1}
              >
                {item.label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Seller top bar ──────────────────────────────────────────────────────────

const ALL_SELLER_ITEMS = SELLER_DESKTOP_NAV.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.title ?? 'Home' })));

function DesktopTopBar() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const segments = useSegments() as string[];
  const navigateTo = useNavigateTo();
  const { user } = useUser();
  const [query, setQuery] = React.useState('');
  const [focused, setFocused] = React.useState(false);

  const previewName = previewSellerPersonName();
  const firstName = user?.firstName ?? previewName?.firstName ?? 'Seller';
  const lastName = user?.lastName ?? previewName?.lastName ?? '';
  const displayName = lastName ? `${firstName} ${lastName}` : firstName;

  const trimmed = query.trim().toLowerCase();
  const matches = trimmed
    ? ALL_SELLER_ITEMS.filter((item) =>
      item.label.toLowerCase().includes(trimmed) || item.group.toLowerCase().includes(trimmed)).slice(0, 8)
    : [];

  const choose = (href: string) => {
    setQuery('');
    navigateTo(href);
  };

  // Same context mapping as the bottom bar's AI button (SellerGlobalTabBar).
  const openAI = () => {
    const onDashboard = segments[0] === '(tabs)' && (segments[1] ?? 'index') === 'index';
    const owned = getActiveTab(segments);
    const screen = owned === 'products' ? 'products' : owned === 'orders' ? 'orders' : onDashboard ? 'home' : 'general';
    router.push({ pathname: '/ai-brain', params: { context: JSON.stringify({ screen }) } } as never);
  };

  return (
    <View testID="desktop-top-bar" style={[styles.topBar, { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
      <View style={styles.searchWrap}>
        <View style={[styles.searchField, { backgroundColor: theme.surface, borderColor: focused ? theme.border : theme.borderSubtle }]}>
          <Icon name="search" size={16} color={theme.muted} />
          <TextInput
            testID="desktop-top-bar-search"
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            // Delay so a click on a result lands before the list closes.
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onSubmitEditing={() => { if (matches[0]) choose(matches[0].href); }}
            placeholder="Search"
            placeholderTextColor={theme.muted}
            accessibilityLabel="Search seller tools"
            style={[styles.searchInput, { color: theme.text }]}
          />
        </View>
        {focused && matches.length > 0 ? (
          <View style={[styles.searchResults, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
            {matches.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="link"
                onPress={() => choose(item.href)}
                style={(state) => [styles.searchResult, (state as { hovered?: boolean }).hovered && { backgroundColor: theme.surface }]}
              >
                <Icon name={item.icon} size={16} color={theme.muted} />
                <Text style={[styles.searchResultLabel, { color: theme.text }]} numberOfLines={1}>{item.label}</Text>
                <Text style={[styles.searchResultGroup, { color: theme.muted }]} numberOfLines={1}>{item.group}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.topBarActions}>
        <Pressable
          testID="desktop-top-bar-ai"
          accessibilityRole="button"
          accessibilityLabel="Open Brandthread AI"
          onPress={openAI}
          style={(state) => [styles.aiButton, { borderColor: theme.borderSubtle }, (state as { hovered?: boolean }).hovered && { backgroundColor: theme.surface }]}
        >
          <Icon name="zap" size={16} color={theme.text} />
          <Text style={[styles.aiLabel, { color: theme.text }]}>Brandthread AI</Text>
        </Pressable>
        <Pressable
          testID="desktop-top-bar-profile"
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          onPress={() => navigateTo('/(tabs)/profile')}
          style={(state) => [styles.profileButton, (state as { hovered?: boolean }).hovered && { backgroundColor: theme.surface }]}
        >
          <Avatar uri={user?.imageUrl} name={displayName} size={30} />
          <Text style={[styles.profileName, { color: theme.text }]} numberOfLines={1}>{displayName}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },
  contentArea: { flex: 1, minHeight: 0, alignItems: 'center' },
  column: { flex: 1, maxWidth: '100%', overflow: 'hidden' },
  classicColumn: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },

  sidebar: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  sidebarHeader: {
    height: TOP_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: 14,
  },
  sidebarHeaderCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  iconButton: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontFamily: FONT.bold, fontSize: FS.md, letterSpacing: -0.2 },
  sidebarScroll: { flex: 1 },
  sidebarScrollContent: { paddingHorizontal: 12, paddingBottom: SP.lg },
  sidebarScrollContentCollapsed: { paddingHorizontal: 12, alignItems: 'center' },
  group: { marginTop: SP.md },
  groupTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.meta,
    paddingHorizontal: 10,
    marginBottom: SP.xs,
  },
  groupDivider: { height: StyleSheet.hairlineWidth, width: 32, alignSelf: 'center', marginBottom: SP.sm },
  navItem: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  navItemCollapsed: { width: 44, height: 40, justifyContent: 'center', paddingHorizontal: 0, gap: 0 },
  navLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm },
  navLabelActive: { fontFamily: FONT.semibold },

  topBar: {
    height: TOP_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    paddingHorizontal: CONTENT_GUTTER,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  searchWrap: { flex: 1, maxWidth: 560, marginHorizontal: 'auto' },
  searchField: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, height: 36, fontFamily: FONT.regular, fontSize: FS.sm, outlineStyle: 'none' } as never,
  searchResults: {
    position: 'absolute',
    top: 42,
    left: 0,
    right: 0,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SP.xs,
  },
  searchResult: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  searchResultLabel: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm },
  searchResultGroup: { fontFamily: FONT.regular, fontSize: FS.meta },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  aiButton: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  aiLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
  profileButton: { height: 40, flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: 6, borderRadius: 8, maxWidth: 220 },
  profileName: { fontFamily: FONT.medium, fontSize: FS.sm, flexShrink: 1 },
});

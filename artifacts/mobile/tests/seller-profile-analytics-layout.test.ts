import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const profileSource = fs.readFileSync(
  path.resolve(__dirname, '../app/(tabs)/profile.tsx'),
  'utf8',
);
const analyticsSource = fs.readFileSync(
  path.resolve(__dirname, '../app/(tabs)/analytics.tsx'),
  'utf8',
);
// The zero-safe trend guard now lives in the shared analytics kit (reused by
// all seller analytics screens) rather than being duplicated per screen.
const analyticsKitSource = fs.readFileSync(
  path.resolve(__dirname, '../components/analytics/AnalyticsKit.tsx'),
  'utf8',
);

describe('seller profile action layout', () => {
  // Instagram own-business-profile shape (mobbin.com/screens/
  // 7b7b7c39-39a7-4ba6-bf3a-45c009a4769d): a "Professional dashboard" row
  // above the action row — replacing the old six-button wall (Edit Profile,
  // Settings, Go Live, Create Post, My Profile, Messages), then later
  // trimmed by Dev to just Edit (compact, left) + one long Messages button
  // (ProfileEditMessagesRow) — Share moved off the action row (it's still
  // reachable from the top-bar share icon) and Contact was folded into the
  // new Messages button. Settings stays in the top-right gear; Go Live and
  // Create Post live in the Studio control center.
  it('shows the Professional dashboard row and the Edit + Messages action row below it', () => {
    expect(profileSource).toContain('Professional dashboard');
    expect(profileSource).toContain('<ProfileEditMessagesRow');
    expect(profileSource).toContain("onEdit={() => nav('/edit-profile')}");
    expect(profileSource).toContain("onMessages={() => nav('/seller-inbox')}");
    // The top-bar share icon (testID="seller-share-profile-btn") keeps its
    // own "Share profile" accessibility label — only the action row's
    // separate Share text button is gone.
    expect(profileSource).not.toContain('testID="profile-share-btn"');
    expect(profileSource).not.toContain('testID="profile-contact-btn"');
    expect(profileSource).not.toContain("label='Go Live'");
    expect(profileSource).not.toContain('accessibilityLabel="Go Live"');
    expect(profileSource).not.toContain("label='Create Post'");
    expect(profileSource).not.toContain('accessibilityLabel="Create Post"');
    expect(profileSource).not.toContain("label: 'My Profile'");
    expect(profileSource).not.toContain("QUICK_ACTIONS");
  });

  it('never lets the stats row get stuck on "–" — loading resolves once the initial fetch settles, not on profile alone', () => {
    expect(profileSource).toContain('statsLoading={statsInitialLoading}');
    expect(profileSource).not.toContain('statsLoading={!profile}');
    expect(profileSource).toContain('Promise.allSettled([loadPosts(), loadProfile(), loadSocialCounts()])');
    // Second, independent guarantee — even if auth itself never resolves,
    // the row still falls back to real (zero) values instead of "–" forever.
    expect(profileSource).toContain("setTimeout(() => setStatsInitialLoading(false), 6000)");
  });

  it('uses Instagram Posts / Products / Tagged icon tabs with no second filter row', () => {
    expect(profileSource).toContain("const CONTENT_TABS = ['Posts', 'Shop', 'Tagged']");
    // The old Published/Drafts/Products segmented control under Posts is
    // gone — the icon tab row above the grid is the only tab control now.
    // "Shop" keeps its internal key (every activeTab === 'Shop' branch is
    // unchanged) but its accessible label is "Products", so the products
    // grid is still explicitly reachable from an icon tab.
    expect(profileSource).toContain("{ key: 'Shop', label: 'Products', icon: 'shopping-bag' }");
    expect(profileSource).not.toContain('POST_FILTERS');
    expect(profileSource).not.toContain('seller-post-filters');
    expect(profileSource).toContain('tabsVariant="iconOnly"');
    expect(profileSource).not.toContain('Store performance');
  });

  it('surfaces drafts as an Instagram-style folder tile in the Posts grid instead of a filter pill', () => {
    expect(profileSource).toContain("testID=\"seller-profile-drafts-tile\"");
    expect(profileSource).toContain("router.push('/content?tab=draft' as never)");
    expect(profileSource).toContain("kind: 'draftsTile'");
  });

  it('reaches post creation from the Studio control center instead of a top action button', () => {
    expect(profileSource).not.toContain('Share something with');
    // The empty Post tab offers "Create your first post" through the shared
    // profile empty-state table (components/profile/profileEmptyStates.ts).
    expect(fs.readFileSync(path.join(__dirname, '../components/profile/profileEmptyStates.ts'), 'utf8'))
      .toContain("label: 'Create your first post', route: '/create-post'");
    const controlCenterSource = fs.readFileSync(
      path.resolve(__dirname, '../lib/sellerControlCenter.ts'),
      'utf8',
    );
    expect(controlCenterSource).toContain("route: '/create-post'");
    expect(controlCenterSource).toContain("route: '/seller-go-live'");
  });
});

describe('seller analytics overview layout', () => {
  // The "14 Days"/"Custom" ranges and the "Leads"/"Traffic sources" cards
  // were non-functional stubs (always empty, no backing API) and were
  // removed as a P0 fix — see docs/polish/punch-list.md, Seller Analytics.
  // Only the working 7-day range ships now.
  it('renders only the working 7-day range, real metrics, and the chart', () => {
    expect(analyticsSource).not.toContain("label: '14 Days'");
    expect(analyticsSource).not.toContain("label: 'Custom'");
    expect(analyticsSource).not.toContain('label="Leads"');
    expect(analyticsSource).toContain('Last 7 days');
    expect(analyticsSource).toContain('label="Visits"');
    expect(analyticsSource).toContain('label="Revenue"');
    expect(analyticsSource).toContain('Daily Revenue');
  });

  it('uses zero-safe data and omits fabricated trends and traffic sources', () => {
    expect(analyticsKitSource).toContain('Number.isFinite(changePct)');
    expect(analyticsSource).not.toContain('TikTok');
    expect(analyticsSource).not.toContain('-65%');
  });
});
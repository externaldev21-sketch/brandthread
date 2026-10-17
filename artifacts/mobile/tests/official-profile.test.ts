import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const official = read('lib/officialAccount.ts');
const profile = read('app/seller-profile.tsx');
const comments = read('app/buyer-post-comments.tsx');
const videos = read('components/profile/useCreatorVideos.ts');

describe('official @brandthread profile', () => {
  it('uses the bundled silver B logo as the shared official avatar', () => {
    expect(official).toContain("require('../assets/images/brandthread-logo.png')");
    expect(official).toContain("OFFICIAL_HANDLE = '@brandthread'");
    expect(official).toContain("OFFICIAL_BIO = 'The official Brandthread account.'");
    expect(official).toContain("OFFICIAL_ACCOUNT_ID = 'brandthread-official'");
  });

  it('prefers the bundled mark over a possibly broken stored avatar URL', () => {
    expect(profile).toMatch(/isOfficialAccountId\(profile\?\.clerkId\)\)\s*\?\s*\(officialAvatarUri\(\)/);
  });

  it('renders a plain black hero when the official account has no cover', () => {
    expect(profile).toContain('seller?.isOfficial\n            ? { videoUri: null, posterUri: null, plain: true }');
    expect(profile).toContain('coverFlow.hasCover');
  });

  it('only uses demo fixtures behind demo=1', () => {
    expect(videos).toContain('isPreviewDemoMode() && isOfficialAccountId(userId)');
    expect(profile).toContain('isPreviewDemoMode() && isOfficialAccountId(routeSellerId)');
  });

  it('shows the official mark on comments', () => {
    expect(comments).toContain('isOfficialAccountId(comment.author.userId) ? (officialAvatarUri()');
  });
});

const share = read('components/ThreadShareSheet.tsx');
const recents = read('lib/shareRecents.ts');
const inbox = read('components/inbox/MessagesInbox.tsx');
const thread = read('components/chat/ConversationThread.tsx');
const hero = read('components/profile/ProfileHeroMedia.tsx');
const grid = read('components/profile/ProfileVideoGrid.tsx');

describe('official mark on share + DM surfaces', () => {
  it('share sheet renders official B, real photo, else initials', () => {
    expect(share).toContain('official: friend.isOfficial || isOfficialAccountId(friend.userId)');
    expect(share).toMatch(/avatar\?\.official \? \(\s*<Image source=\{OFFICIAL_AVATAR_SOURCE\}/);
    expect(share).toMatch(/avatar\?\.uri \? \(\s*<Image source=\{\{ uri: avatar\.uri \}\}/);
    expect(recents).toContain('isOfficial: isOfficialAccountId(p.userId)');
    expect(recents).toContain('avatarUri: httpUri(p.avatarUri)');
  });
  it('inbox rows and requests detect the official id', () => {
    expect(inbox).toContain('conv.isOfficial || isOfficialAccountId(participant.userId)');
    expect(inbox).toMatch(/isOfficialAccountId\(participant\.userId\) \? \(\s*<View style=\{\[s\.avatar48, s\.officialAvatar/);
  });
  it('chat header and bubbles use the mark and real photos', () => {
    expect(thread).toContain('const showOfficialMark = isAgentConv || isOfficialAccountId(participant?.userId)');
    expect(thread).toContain('testID="conversation-avatar-image"');
    expect(thread.match(/participant\?\.avatarUri \? \(/g)?.length).toBe(2);
  });
});

describe('official hero + grid', () => {
  it('opens the official account on Posts instead of its empty shop', () => {
    expect(profile).toContain('useProfilePostsDefault(setActiveTab,');
    expect(profile).not.toContain('tabPickedRef');
  });
  it('requires a real sign-in before following the real official account, even in dev preview', () => {
    expect(profile).toMatch(/seller\?\.isOfficial && !userId && !isPreviewDemoMode\(\)\)\s*\{\s*goToSignIn\(\);\s*return;/);
    expect(profile.indexOf('seller?.isOfficial && !userId')).toBeLessThan(profile.indexOf('const previous = { isFollowing, followers }'));
    expect(profile).toContain('(!userId && !seller?.isOfficial)');
  });
  it('plain hero is true black (BG), not the theme gradient', () => {
    expect(hero).toContain('plain ? (');
    expect(hero).toContain('backgroundColor: BG');
    expect(profile).toContain('{ videoUri: null, posterUri: null, plain: true }');
  });
  it('grid marks slideshows as multi-photo and videos with play + views', () => {
    expect(grid).toContain("item.kind === 'slideshow' ? 'layers'");
    expect(grid).toContain("icon: 'play' as const, value: formatCompactCount(item.viewsCount)");
    expect(grid).toContain("item.kind === 'video' && typeof item.viewsCount === 'number'");
  });
});

describe('search brand row', () => {
  const row = read('components/search/BrandRow.tsx');
  const results = read('components/discover/search/SearchResults.tsx');
  it('official result renders bundled logo; other brands their photo, else initials', () => {
    expect(results).toContain('official: b.isOfficial === true || isOfficialAccountId(b.sellerId ?? b.id)');
    expect(results).toContain('imageUri: b.imageUri ?? b.avatarUrl ?? null');
    expect(row).toMatch(/brand\.official \? \([\s\S]*OFFICIAL_AVATAR_SOURCE/);
    expect(row).toContain('testID="brand-row-avatar-image"');
  });
});

describe('/u/:username lookup', () => {
  const u = read('app/u/[username].tsx');
  it('forwards the Clerk token only when signed in, after auth loads, with generation guard', () => {
    expect(u).toContain("...(token ? { Authorization: `Bearer ${token}` } : {})");
    expect(u).toContain('if (!authLoaded) return;');
    expect(u).toContain('isSignedIn ? await getTokenRef.current().catch(() => null) : null');
    expect(u).toContain('generation !== generationRef.current');
  });
});

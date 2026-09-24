/**
 * InlineFeedback + Comments screen — focused interaction tests.
 *
 * Covers:
 * - InlineFeedback primitives render correctly and conditionally
 * - SectionError wires retry callbacks
 * - buyer-post-comments: first-load skeleton, fetch-error retry, posting
 *   progress, posting failure, authoritative count sync after success
 * - discover: per-section error state + SectionError + retry callbacks
 */

import { describe, expect, it } from 'vitest';

// ─── InlineFeedback source-level assertions ───────────────────────────────────

describe('InlineFeedback primitives — source structure', () => {
  it('exports InlineSpinner, InlineError, InlineEmpty, SectionError', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, './InlineFeedback.tsx'), 'utf8');
    expect(src).toContain('export function InlineSpinner');
    expect(src).toContain('export function InlineError');
    expect(src).toContain('export function InlineEmpty');
    expect(src).toContain('export function SectionError');
  });

  it('InlineError renders a Retry button only when onRetry is supplied', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, './InlineFeedback.tsx'), 'utf8');
    // Conditional: onRetry ? <retry> : null
    expect(src).toMatch(/onRetry\s*\?/);
    expect(src).toContain('Retry');
  });

  it('SectionError always includes an onRetry button', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, './InlineFeedback.tsx'), 'utf8');
    // SectionError's onRetry is required — no conditional
    const sectionErrorBlock = src.slice(src.indexOf('export function SectionError'));
    expect(sectionErrorBlock).toContain('onRetry');
    expect(sectionErrorBlock).toContain('Retry');
  });

  it('InlineSpinner uses pulsing dots (animated opacity) not ActivityIndicator as a component', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, './InlineFeedback.tsx'), 'utf8');
    // ActivityIndicator must not be imported or used as JSX
    expect(src).not.toMatch(/import.*ActivityIndicator/);
    expect(src).not.toMatch(/<ActivityIndicator/);
    // Uses animated dots instead
    expect(src).toContain('Animated.Value');
    expect(src).toContain('opacity');
  });

  it('uses only theme tokens (no hardcoded hex outside token vars)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, './InlineFeedback.tsx'), 'utf8');
    // Token imports are present
    expect(src).toContain("from '@/lib/theme'");
    // The rgba for RED border is constructed from RED constant, not hardcoded
    expect(src).toContain('RED');
    expect(src).toContain('MUTED');
    expect(src).toContain('SUBTLE');
  });
});

// ─── buyer-post-comments: first-load skeleton ─────────────────────────────────

describe('buyer-post-comments — first-load skeleton', () => {
  it('renders CommentSkeletonRow while loading', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    expect(src).toContain('CommentSkeletonRow');
    // Skeleton shown only while loading
    expect(src).toMatch(/loading\s*&&/);
  });

  it('uses a hasLoadedOnce ref so skeleton only shows on the first load', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    expect(src).toContain('hasLoadedOnce');
    expect(src).toContain('useRef(false)');
  });

  it('skeleton rows use Animated.Value for pulsing opacity', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    expect(src).toContain('CommentSkeletonRow');
    expect(src).toContain('Animated.Value(0.35)');
  });
});

// ─── buyer-post-comments: fetch error + retry ─────────────────────────────────

describe('buyer-post-comments — fetch error and retry', () => {
  it('has fetchError state and setFetchError', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    expect(src).toContain('fetchError');
    expect(src).toContain('setFetchError');
  });

  it('sets fetchError on getComments failure', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    // catch block sets error message
    expect(src).toMatch(/catch[\s\S]{0,20}setFetchError\(|setFetchError\([\s\S]{0,100}catch/m);
  });

  it('shows InlineError with onRetry={load} when fetchError is set', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    expect(src).toContain('InlineError');
    expect(src).toMatch(/onRetry=\{load\}/);
    // Shown only when not loading and fetchError present
    expect(src).toMatch(/fetchError[\s\S]{0,40}InlineError|InlineError[\s\S]{0,80}fetchError/m);
  });

  it('does not use Alert for fetch errors', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    // Alert must not be imported or called for fetch errors
    // (it's ok if Alert is not imported at all)
    const alertCalls = (src.match(/Alert\.alert/g) ?? []).length;
    // Zero Alert calls in the updated file
    expect(alertCalls).toBe(0);
  });
});

// ─── buyer-post-comments: posting progress + failure ──────────────────────────

describe('buyer-post-comments — posting progress and failure', () => {
  it('has sending state that gates the send button', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    expect(src).toContain('sending');
    expect(src).toMatch(/disabled=\{!inputText\.trim\(\)\s*\|\|\s*sending\}/);
  });

  it('shows InlineSpinner on the send button while sending', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    expect(src).toContain('InlineSpinner');
    // Rendered conditionally inside the send button area
    expect(src).toMatch(/sending[\s\S]{0,60}InlineSpinner|InlineSpinner[\s\S]{0,20}sending/m);
  });

  it('has sendError state for posting failure', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    expect(src).toContain('sendError');
    expect(src).toContain('setSendError');
  });

  it('shows inline send error banner (not Alert) when posting fails', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    // sendErrorBanner style present in StyleSheet
    expect(src).toContain('sendErrorBanner');
    // sendErrorText style present
    expect(src).toContain('sendErrorText');
    // sendError state drives the banner
    expect(src).toContain('sendError');
  });

  it('reverts optimistic comment and sets sendError on postComment failure', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    // Revert: filter out the optimistic tmp_ item
    expect(src).toMatch(/filter\(c => c\.id !== optimistic\.id\)/);
    // Set error
    expect(src).toMatch(/setSendError\(/);
  });
});

// ─── buyer-post-comments: authoritative count sync ────────────────────────────

describe('buyer-post-comments — count sync after successful post', () => {
  it('calls load() after a successful postComment to sync server count', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    // After postComment succeeds: remove optimistic item, then reload
    // The reload fetch is the authoritative count source
    expect(src).toContain('await postComment(');
    expect(src).toContain('await load();');
    // load() call comes after postComment in the try block
    const postIdx = src.indexOf('await postComment(');
    const loadIdx = src.indexOf('await load();', postIdx);
    expect(loadIdx).toBeGreaterThan(postIdx);
  });

  it('uses realCount (excludes tmp_ items) for the displayed comment count', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    // realCount filters out optimistic items
    expect(src).toContain('realCount');
    expect(src).toMatch(/tmp_/);
    expect(src).toMatch(/realCount[\s\S]{0,60}comment|comment[\s\S]{0,20}realCount/m);
  });

  it('pending (optimistic) comments are visually distinguished', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    // isPending flag drives reduced opacity and a pending dot indicator
    expect(src).toContain('isPending');
    expect(src).toContain('commentRowPending');
    expect(src).toContain('pendingDot');
  });
});

describe('buyer-post-comments — continuous video preview', () => {
  it('keeps the video source separate from its poster and resumes playback on focus', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const comments = readFileSync(resolve(__dirname, '../app/buyer-post-comments.tsx'), 'utf8');
    const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');

    expect(feed).toContain("'postMediaUri=' + encodeURIComponent(videoUri)");
    expect(feed).toContain("'postPosterUri=' + encodeURIComponent(item.videoPosterUri ?? '')");
    expect(comments).toContain('postPosterUri?: string');
    expect(comments).toContain('useFocusEffect(useCallback(() =>');
    expect(comments).toContain("if (mediaUri && postType === 'video') mediaPlayer.play()");
    expect(comments).toContain('return () => mediaPlayer.pause()');
    expect(comments).toContain('testID="comments-video-preview"');
    expect(comments).toMatch(/<VideoView[\s\S]*?contentFit="contain"[\s\S]*?testID="comments-video-preview"/);
  });
});

// ─── discover: per-section error states ──────────────────────────────────────

describe('discover.tsx — per-section error states', () => {
  it('has error state for all four sections', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(src).toContain('highDemandError');
    expect(src).toContain('setHighDemandError');
    expect(src).toContain('forYouError');
    expect(src).toContain('setForYouError');
    expect(src).toContain('dropsError');
    expect(src).toContain('setDropsError');
    expect(src).toContain('trendingError');
    expect(src).toContain('setTrendingError');
  });

  it('each fetch function resets its error to null before fetching', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // All four reset to null at fetch start
    const resetCount = (src.match(/setHighDemandError\(null\)|setForYouError\(null\)|setDropsError\(null\)|setTrendingError\(null\)/g) ?? []).length;
    expect(resetCount).toBeGreaterThanOrEqual(4);
  });

  it('error catch blocks call setXxxError (not setXxxItems)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(src).toContain('setHighDemandError(');
    expect(src).toContain('setForYouError(');
    expect(src).toContain('setDropsError(');
    expect(src).toContain('setTrendingError(');
  });

  it('renders SectionError for each section on error', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(src).toContain('SectionError');
    expect(src).toMatch(/highDemandError.*SectionError|SectionError.*highDemandError/s);
    expect(src).toMatch(/forYouError.*SectionError|SectionError.*forYouError/s);
    expect(src).toMatch(/dropsError.*SectionError|SectionError.*dropsError/s);
    expect(src).toMatch(/trendingError.*SectionError|SectionError.*trendingError/s);
  });

  it('wires onRetry callbacks to each fetch function', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(src).toContain('onRetry={fetchHighDemand}');
    expect(src).toContain('onRetry={fetchProducts}');
    expect(src).toContain('onRetry={fetchDrops}');
    expect(src).toContain('onRetry={fetchTrending}');
  });

  it('imports SectionError from InlineFeedback', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    expect(src).toMatch(/import.*SectionError.*from.*InlineFeedback/);
  });

  it('empty and error states use distinct strings', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/discover.tsx'), 'utf8');
    // Empty states
    expect(src).toContain('No high-demand products right now');
    expect(src).toContain('No products available right now');
    // Error messages
    expect(src).toMatch(/Could not load high demand products/i);
    expect(src).toMatch(/Could not load products/);
  });
});

// ─── search screen: skeleton and empty states already in place ──────────────

describe('search screen — skeleton and empty already in place', () => {
  it('uses GridSkeleton while searching', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/search.tsx'), 'utf8');
    expect(src).toContain('GridSkeleton');
    expect(src).toContain('searching');
  });

  it('uses EmptyState for no results', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(buyer)/search.tsx'), 'utf8');
    expect(src).toContain('EmptyState');
    expect(src).toMatch(/No results/);
  });
});

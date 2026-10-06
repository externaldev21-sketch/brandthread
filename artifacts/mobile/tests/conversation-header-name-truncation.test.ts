import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

/**
 * Live verification caught this on the seller side: a long contact name
 * (confirmed with "Alexandra Montgomery-Smith") overlapped the call icon
 * instead of truncating — with 3 action icons (call, video, buyer-context)
 * plus the header back button and avatar, there just isn't room for an
 * unclipped long name.
 *
 * First fix attempt (minWidth: 0 down the whole flex chain, plus an explicit
 * ellipsizeMode="tail") did NOT actually work — live re-verification with a
 * genuinely long name still showed the overlap. Root cause: the name/avatar
 * row is wrapped in a PressableScale (so tapping it opens chat details), and
 * PressableScale forwards its `style` prop only to its INNER Animated.View,
 * never to the outer Pressable node that is the real flex participant in
 * headerLeftGroup's row — the exact same root cause as the Messages-button
 * width bug fixed earlier this round. The outer Pressable, receiving no
 * style at all, sized to its unconstrained content width and never shrank,
 * regardless of what flex/minWidth the inner Animated.View was given.
 *
 * Fixed by moving the flex: 1 / minWidth: 0 constraint onto a plain wrapping
 * View around the PressableScale instead (headerCenterWrap) — a plain View's
 * own style always applies to itself directly, no forwarding involved.
 * Applied to both app/seller-conversation.tsx (reported here) and
 * app/buyer-conversation.tsx (a separate, not-shared implementation with the
 * identical PressableScale-wrapped-name bug) for parity.
 */
describe('conversation header name truncates instead of overlapping the action icons', () => {
  describe('app/seller-conversation.tsx', () => {
    // The seller thread now renders the ONE shared thread screen (Dev:
    // "seller messages = buyer messages"), so it gets the buyer header's
    // truncation fix below by construction.
    it('renders the shared thread screen, so its header is the one checked below', () => {
      const route = read('app/seller-conversation.tsx');
      expect(route).toContain("import { ConversationThread } from '@/components/chat/ConversationThread';");
      expect(route).toContain('<ConversationThread variant="seller" />');
    });
  });

  describe('components/chat/ConversationThread.tsx (app/buyer-conversation.tsx + app/seller-conversation.tsx)', () => {
    const src = read('components/chat/ConversationThread.tsx');

    it('renders the name with numberOfLines={1} and an explicit tail ellipsis', () => {
      expect(src).toContain('<Text style={s.headerName} numberOfLines={1} ellipsizeMode="tail">{displayName}</Text>');
    });

    it('wraps the name-row PressableScale (headerCenter) in a plain View carrying flex: 1, minWidth: 0', () => {
      expect(src).toContain('<View style={s.headerCenterWrap}>');
      expect(src).toMatch(/headerCenterWrap:\s*\{\s*flex:\s*1,\s*minWidth:\s*0,?\s*\}/);
      const jsxNameBlock = src.slice(
        src.indexOf('<View style={s.headerCenterWrap}>'),
        src.indexOf('testID="conversation-header-name"'),
      );
      expect(jsxNameBlock).toContain('<PressableScale');
    });

    it('headerTextCol still stretches (not centers) so headerNameRow inherits a bounded width', () => {
      const textColBlock = src.slice(src.indexOf('headerTextCol: {'), src.indexOf('headerTextCol: {') + 500);
      const block = textColBlock.slice(0, textColBlock.indexOf('},'));
      expect(block).not.toContain("alignItems: 'center'");
      expect(block).toMatch(/flex:\s*1/);
      expect(block).toMatch(/minWidth:\s*0/);
    });

    it('gives headerNameRow and headerName minWidth: 0 too', () => {
      expect(src).toMatch(/headerNameRow:\s*\{[^}]*minWidth:\s*0/);
      expect(src).toMatch(/headerName:\s*\{[^}]*minWidth:\s*0/);
    });
  });
});

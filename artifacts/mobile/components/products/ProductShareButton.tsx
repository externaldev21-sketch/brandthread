/**
 * Share control for the buyer product page header (BT-260).
 *
 * Shares the canonical product link (lib/shareLinks.buildProductUrl) through
 * the same native-sheet / Web Share / clipboard fallback the profile screens
 * use (lib/shareProfile.shareLinkWithFallback). A signed-in buyer's referral
 * code is appended as ?ref=CODE; it's fetched on tap (never for guests, never
 * on page load) and cached for the session. When the link is copied instead
 * of shared (desktop web), the icon turns into a check for a moment.
 *
 * Reference: GOAT product page (mobbin.com/screens/fcfcd85a-3191-4e0e-b0cb-02ac3f076210)
 * — share sits with the other floating
 * controls over the photo and opens the system share sheet.
 */
import React, { useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Share, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAuth } from '@clerk/expo';
import { IconButton } from '@/components/ui';
import { useApi } from '@/lib/api';
import { shareLinkWithFallback } from '@/lib/shareProfile';
import { buildProductShareLink, normalizeReferralCode, productShareMessage } from '@/lib/productShare';

// Per signed-in user, so switching accounts never shares someone else's code.
const referralCodeCache = new Map<string, string | null>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export function ProductShareButton({
  productId, productName, iconColor, wrapStyle, buttonStyle,
}: {
  productId: string;
  productName: string;
  /** Icon color; the product page passes the same fixed white as its other photo chrome. */
  iconColor?: string;
  /** Positions the control (absolute, like the back/cart wrappers). */
  wrapStyle?: StyleProp<ViewStyle>;
  /** Same chrome style as the neighbouring header buttons. */
  buttonStyle?: StyleProp<ViewStyle>;
}) {
  const { isSignedIn, userId } = useAuth();
  const api = useApi();
  const [copied, setCopied] = useState(false);
  const busy = useRef(false);

  async function referralCode(): Promise<string | null> {
    if (!isSignedIn || !userId) return null;
    if (referralCodeCache.has(userId)) return referralCodeCache.get(userId) ?? null;
    try {
      const res = await withTimeout(api.referrals.code(), 1500);
      if (!res) return null; // slow network: share the plain link, try again next time
      const code = normalizeReferralCode(res.code);
      referralCodeCache.set(userId, code);
      return code;
    } catch {
      return null;
    }
  }

  async function onShare() {
    if (busy.current) return;
    busy.current = true;
    try {
      const url = buildProductShareLink(productId, await referralCode());
      if (!url) return;
      const result = await shareLinkWithFallback({
        url,
        message: productShareMessage(productName),
        platformOS: Platform.OS,
        nativeShare: (content) => Share.share(content),
        webNavigator: typeof navigator !== 'undefined' ? (navigator as any) : null,
      });
      if (result === 'copied') {
        setCopied(true);
        AccessibilityInfo.announceForAccessibility?.('Link copied');
        setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      // A dismissed or unavailable share sheet is not an error worth surfacing.
    } finally {
      busy.current = false;
    }
  }

  return (
    <View style={wrapStyle}>
      <IconButton
        name={copied ? 'check' : 'share'}
        onPress={() => { void onShare(); }}
        accessibilityLabel={copied ? 'Link copied' : 'Share product'}
        accessibilityHint="Send this product to a friend"
        variant="plain"
        color={iconColor}
        style={buttonStyle}
        testID="product-share-button"
      />
    </View>
  );
}

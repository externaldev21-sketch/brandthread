import React from 'react';
import { View, Text, StyleSheet, Platform, type StyleProp, type ViewStyle, type ImageStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';

/**
 * Standalone product/order card for chat — Dev's "chat card redesign" fix.
 *
 * Mobbin refs: Etsy standalone product card in chat (image-top / name /
 * price, no wrapping bubble or border —
 * mobbin.com/screens/2c63e20a-2503-4588-b49e-9777ea43106a) and eBay's
 * standalone card with a full-width action row at the bottom
 * (mobbin.com/screens/edea69a7-cbd7-40b3-a1b8-d919d147aeac).
 *
 * This card is NEVER rendered inside the text-message bubble — callers
 * render it as its own row in renderItem(), the same way ThreadCashMessageCard
 * and the agent info card are already standalone (see buyer-conversation.tsx
 * / seller-conversation.tsx's renderItem for that established pattern). It
 * has no border of its own (nothing to "look like it's inside a bubble"
 * anymore) and it's ONE tap target for the whole card — no inner Pressable,
 * so a footer "View"/"Track" label is a plain View+Text row, never a nested
 * button (see the no-nested-pressables rule).
 */

export const CHAT_ATTACHMENT_CARD_WIDTH = 240;

export type ChatAttachmentCardProps = {
  theme: AppThemePreset;
  isMe: boolean;
  /** Product photo. Omit (or leave null) for an order card, which shows
   *  `icon` in a centered circle instead — orders have no single photo. */
  imageUri?: string | null;
  icon?: React.ComponentProps<typeof Feather>['name'];
  iconColor?: string;
  title: string;
  /** Price (product) or a plain subtitle line (order, when no status badge
   *  is available yet). Hidden when `unavailable` — the image badge already
   *  says so, a second stale price line would be confusing. */
  priceLabel?: string;
  /** "from {seller}" / seller name line under the price. */
  sellerLine?: string;
  /** Order status chip, rendered in place of `priceLabel` when given. */
  statusBadge?: React.ReactNode;
  unavailable?: boolean;
  footerLabel: string;
  footerIcon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function ChatAttachmentCard({
  theme,
  isMe,
  imageUri,
  icon = 'shopping-bag',
  iconColor,
  title,
  priceLabel,
  sellerLine,
  statusBadge,
  unavailable = false,
  footerLabel,
  footerIcon,
  onPress,
  accessibilityLabel,
  testID,
  style,
}: ChatAttachmentCardProps) {
  const hasImage = !!imageUri;
  // expo-image decodes remote images at their RENDERED size (see
  // components/CachedImage.tsx's own doc comment), which keeps memory
  // bounded — but that's a decode-time optimization only. The full
  // original bytes are still downloaded over the network before any of
  // that happens, so a multi-MB original was exactly as slow to *load* at
  // this ~240pt card as anywhere else (Dev's live Orison thread check: a
  // ~10s load with the blur placeholder visible the whole time). The
  // server now serves a width-capped (~720px) copy of the product's cover
  // image for chat cards specifically, generated and cached on first
  // request — see api-server's lib/productImageResize.ts, wired in via
  // productAttachmentInfo.ts.
  const grayscaleStyle: ImageStyle | null = unavailable
    ? (Platform.OS === 'web'
        ? ({ filter: 'grayscale(1)' } as unknown as ImageStyle)
        : ({ filter: [{ grayscale: 1 }] } as unknown as ImageStyle))
    : null;

  return (
    <PressableScale
      rippleEnabled={false}
      bounce={false}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      // Single tap target for the whole card — no inner Pressable/button
      // anywhere below (the footer "View" row is a plain View+Text), so this
      // is the only interactive element and keeps a real accessibilityRole.
      accessibilityRole="button"
      testID={testID}
      noMinHeight
      style={[s.card, { backgroundColor: theme.card, alignSelf: isMe ? 'flex-end' : 'flex-start' }, style]}
    >
      <View style={s.media} accessibilityRole="none">
        {hasImage ? (
          <CachedImage
            source={{ uri: imageUri! }}
            style={[StyleSheet.absoluteFill, grayscaleStyle]}
            contentFit="contain"
            recyclingKey={imageUri!}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
            <View style={[s.iconCircle, { backgroundColor: theme.card }]}>
              <Feather name={icon} size={26} color={iconColor ?? theme.accent} />
            </View>
          </View>
        )}

        {unavailable && (
          <View style={s.unavailableOverlay} accessibilityRole="none">
            <View style={[s.unavailableBadge, { backgroundColor: theme.muted }]}>
              <Text style={[s.unavailableBadgeText, { color: theme.background }]}>No longer available</Text>
            </View>
          </View>
        )}
      </View>

      <View style={s.body} accessibilityRole="none">
        <Text style={[s.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        {statusBadge ? (
          <View style={s.statusRow}>{statusBadge}</View>
        ) : !unavailable && priceLabel ? (
          <Text style={[s.price, { color: theme.text }]} numberOfLines={1}>{priceLabel}</Text>
        ) : null}
        {sellerLine ? (
          <Text style={[s.sellerLine, { color: theme.muted }]} numberOfLines={1}>{sellerLine}</Text>
        ) : null}
      </View>

      <View style={[s.footer, { borderTopColor: theme.border }]} accessibilityRole="none">
        <Text style={[s.footerText, { color: theme.text }]}>{footerLabel}</Text>
        <Feather name={footerIcon} size={13} color={theme.text} style={s.footerIcon} />
      </View>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  card: {
    width: CHAT_ATTACHMENT_CARD_WIDTH,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    // No border — the card is a free-floating unit, not something faking
    // "inside a bubble" anymore.
  },
  media: {
    width: '100%',
    // 3:4 — matches how product/post photos are now saved (cropped by the
    // creator to 3:4 at upload time), and still clearly bigger than the old
    // 44×44 inline thumbnail this replaces.
    aspectRatio: 3 / 4,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.md,
  },
  unavailableBadge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  unavailableBadgeText: {
    fontSize: FS.meta,
    fontFamily: FONT.bold,
    letterSpacing: 0.1,
  },
  body: {
    paddingHorizontal: SP.sm,
    paddingTop: SP.sm,
    paddingBottom: SP.xs,
  },
  title: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
  },
  price: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  sellerLine: {
    fontSize: FS.meta,
    fontFamily: FONT.medium,
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: SP.sm,
    gap: 4,
  },
  footerText: {
    fontSize: FS.meta,
    fontFamily: FONT.semibold,
  },
  footerIcon: {
    marginTop: 1,
  },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { FONT, FS, SP, RADIUS, ICON, SUCCESS, RED } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { SheetRise } from '@/components/motion/SheetRise';
import { buildCanonicalProfileUrl, normalizeUsername, shareLinkWithFallback } from '@/lib/shareProfile';
import {
  captureShareCard, saveCardImageToLibrary, shareCardToInstagramStories,
  type BuyerShareCardData, type SellerShareCardData, type ShareCardVariant, type CardThumbnail,
} from '@/lib/shareCard';
import { BuyerShareCard } from '@/components/share-cards/BuyerShareCard';
import { SellerShareCard } from '@/components/share-cards/SellerShareCard';

const VARIANTS: ShareCardVariant[] = ['portrait', 'grid'];
const CARD_GAP = SP.md;

interface BuyerExtra {
  statLabel: string;
  statValue: number;
  topPosts: CardThumbnail[];
}

interface SellerExtra {
  rating: { avgRating: number; totalCount: number } | null;
  products: CardThumbnail[];
}

interface ShareProfileSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Avatar/logo image the caller already has loaded — api.auth.me() doesn't return one. */
  avatarUrl?: string | null;
  buyerExtra?: BuyerExtra;
  sellerExtra?: SellerExtra;
}

interface OwnIdentity {
  username: string | null;
  displayName: string | null;
  brandName: string | null;
  accountType: 'buyer' | 'seller' | null;
}

type BusyAction = 'stories' | 'save' | 'copy' | 'more' | null;

/**
 * Bottom sheet for sharing the signed-in user's own profile: a swipeable
 * carousel of IG-story-ready cards (buyer or seller design, based on the
 * account's own type), plus Share to Instagram Stories / Save image / Copy
 * Link / More actions. Each card is captured to a 1080x1920 PNG on demand —
 * nothing is pre-rendered at full size, so the sheet stays cheap to open.
 */
export function ShareProfileSheet({ visible, onClose, avatarUrl, buyerExtra, sellerExtra }: ShareProfileSheetProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const router = useRouter();

  const [identity, setIdentity] = useState<OwnIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean; variant: 'success' | 'error' }>({
    message: '', visible: false, variant: 'success',
  });

  const cardRefs = useRef<Array<View | null>>([]);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const data = await api.auth.me();
      setIdentity({
        username: data.username ?? null,
        displayName: data.displayName ?? data.name ?? null,
        brandName: data.brandName ?? null,
        accountType: data.accountType ?? null,
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!visible) return;
    setPageIndex(0);
    void load();
  }, [visible, load]);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const showToast = useCallback((message: string, variant: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, visible: true, variant });
    toastTimerRef.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 2200);
  }, []);

  const normalizedUsername = normalizeUsername(identity?.username);
  const canonicalUrl = buildCanonicalProfileUrl(identity?.username);
  const handle = normalizedUsername ? `@${normalizedUsername}` : '';

  const cardData: (BuyerShareCardData | SellerShareCardData) | null = useMemo(() => {
    if (!identity) return null;
    if (identity.accountType === 'seller') {
      return {
        kind: 'seller',
        brandName: identity.brandName || identity.displayName || 'Brandthread Seller',
        handle,
        logoUri: avatarUrl ?? null,
        rating: sellerExtra?.rating ?? null,
        products: sellerExtra?.products ?? [],
      };
    }
    return {
      kind: 'buyer',
      name: identity.displayName || 'Brandthread Member',
      handle,
      avatarUri: avatarUrl ?? null,
      statLabel: buyerExtra?.statLabel ?? 'friends',
      statValue: buyerExtra?.statValue ?? 0,
      topPosts: buyerExtra?.topPosts ?? [],
    };
  }, [identity, handle, avatarUrl, buyerExtra, sellerExtra]);

  const handleEditProfile = useCallback(() => {
    onClose();
    router.push((identity?.accountType === 'seller' ? '/edit-profile' : '/(buyer)/edit-profile') as never);
  }, [identity?.accountType, onClose, router]);

  const runAction = useCallback(async (action: Exclude<BusyAction, null>, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    try {
      await fn();
    } catch {
      showToast("Couldn't complete that. Try again.", 'error');
    } finally {
      setBusy(null);
    }
  }, [busy, showToast]);

  const captureCurrentCard = useCallback(async () => {
    const ref = cardRefs.current[pageIndex];
    if (!ref) throw new Error('card-not-ready');
    return captureShareCard({ current: ref });
  }, [pageIndex]);

  const handleCopyLink = useCallback(() => {
    if (!canonicalUrl) return;
    void runAction('copy', async () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (Platform.OS === 'web') {
        if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(canonicalUrl);
      } else {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.setStringAsync(canonicalUrl);
      }
      showToast('Copied!');
    });
  }, [canonicalUrl, runAction, showToast]);

  const handleInstagramStories = useCallback(() => {
    void runAction('stories', async () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const imageUri = await captureCurrentCard();
      const result = await shareCardToInstagramStories(imageUri);
      if (result === 'cancelled') return;
      if (result === 'system') showToast('Shared');
    });
  }, [captureCurrentCard, runAction, showToast]);

  const handleSaveImage = useCallback(() => {
    void runAction('save', async () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const imageUri = await captureCurrentCard();
      const result = await saveCardImageToLibrary(imageUri);
      if (result.ok) {
        showToast('Saved to Photos');
      } else {
        showToast('Enable Photos access to save this card.', 'error');
      }
    });
  }, [captureCurrentCard, runAction, showToast]);

  // "More" opens the system share sheet with the profile's real
  // brandthread.app link. Web uses the Web Share API when the browser has it
  // and otherwise copies the link (react-native-web's Share.share throws
  // without navigator.share).
  const handleMore = useCallback(() => {
    if (!canonicalUrl) return;
    void runAction('more', async () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const { Share } = await import('react-native');
      const name = cardData?.kind === 'seller' ? cardData.brandName : cardData?.name;
      const result = await shareLinkWithFallback({
        url: canonicalUrl,
        message: name ? `${name} on Brandthread` : 'Find me on Brandthread',
        platformOS: Platform.OS,
        nativeShare: (content) => Share.share(content),
        webNavigator: typeof navigator !== 'undefined' ? (navigator as any) : null,
      });
      if (result === 'copied') showToast('Link copied');
      else if (result === 'unavailable') showToast("Sharing isn't available here. Use Copy link.", 'error');
    });
  }, [canonicalUrl, cardData, runAction, showToast]);

  const onScrollEnd = useCallback((e: { nativeEvent: { contentOffset: { x: number } } }) => {
    const width = 252 + CARD_GAP;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    setPageIndex(Math.max(0, Math.min(VARIANTS.length - 1, next)));
  }, []);

  // Mounting nothing while closed keeps this sheet cheap to embed in every
  // profile screen — it never renders its carousel, QR code, or capture refs
  // until the user actually taps Share.
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: `${theme.background}55` }]} onPress={onClose} />
      <SheetRise style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={[styles.title, { color: theme.text }]}>Share Profile</Text>
          <Pressable onPress={onClose} style={[styles.close, { backgroundColor: theme.surface }]} accessibilityLabel="Close share sheet" testID="share-profile-sheet-close">
            <Feather name="x" size={20} color={theme.text} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.text} />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[styles.errorText, { color: theme.muted }]}>Couldn't load your profile.</Text>
            <Pressable onPress={() => void load()} accessibilityRole="button">
              <Text style={[styles.retryText, { color: theme.text }]}>Retry</Text>
            </Pressable>
          </View>
        ) : !normalizedUsername || !cardData ? (
          <View style={styles.centered}>
            <Text style={[styles.errorText, { color: theme.muted }]}>
              Set a username to get a shareable profile card.
            </Text>
            <Pressable onPress={handleEditProfile} accessibilityRole="button">
              <Text style={[styles.retryText, { color: theme.text }]}>Set Username</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              snapToInterval={252 + CARD_GAP}
              decelerationRate="fast"
              contentContainerStyle={styles.carousel}
              onMomentumScrollEnd={onScrollEnd}
            >
              {VARIANTS.map((variant, index) => (
                <View key={variant} style={{ marginRight: index === VARIANTS.length - 1 ? 0 : CARD_GAP }}>
                  {cardData.kind === 'seller' ? (
                    <SellerShareCard
                      ref={node => { cardRefs.current[index] = node; }}
                      theme={theme}
                      data={cardData}
                      variant={variant}
                      qrValue={canonicalUrl}
                    />
                  ) : (
                    <BuyerShareCard
                      ref={node => { cardRefs.current[index] = node; }}
                      theme={theme}
                      data={cardData}
                      variant={variant}
                      qrValue={canonicalUrl}
                    />
                  )}
                </View>
              ))}
            </ScrollView>

            <View style={styles.dots}>
              {VARIANTS.map((variant, index) => (
                <View
                  key={variant}
                  style={[
                    styles.dot,
                    { backgroundColor: index === pageIndex ? theme.text : theme.border },
                  ]}
                />
              ))}
            </View>

            <View style={styles.actionRow}>
              <ShareSheetAction
                theme={theme}
                icon="instagram"
                label="Instagram"
                busy={busy === 'stories'}
                onPress={handleInstagramStories}
              />
              <ShareSheetAction
                theme={theme}
                icon="download"
                label="Save image"
                busy={busy === 'save'}
                onPress={handleSaveImage}
              />
              <ShareSheetAction
                theme={theme}
                icon={busy === 'copy' ? 'check' : 'link-2'}
                label="Copy link"
                busy={busy === 'copy'}
                onPress={handleCopyLink}
              />
              <ShareSheetAction
                theme={theme}
                icon="more-horizontal"
                label="More"
                busy={busy === 'more'}
                onPress={handleMore}
              />
            </View>
          </>
        )}
      </SheetRise>

      <View pointerEvents="none" style={[styles.toastWrap, { bottom: insets.bottom + 90 }]}>
        <ShareToast message={toast.message} visible={toast.visible} variant={toast.variant} theme={theme} />
      </View>
    </Modal>
  );
}

function ShareToast({
  message, visible, variant, theme,
}: {
  message: string;
  visible: boolean;
  variant: 'success' | 'error';
  theme: { card: string };
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 150, useNativeDriver: true }).start();
  }, [visible, opacity]);
  const color = variant === 'success' ? SUCCESS : RED;
  return (
    <Animated.View style={[styles.toast, { opacity, backgroundColor: theme.card, borderColor: `${color}44` }]}>
      <Feather name={variant === 'success' ? 'check-circle' : 'alert-circle'} size={ICON.sm} color={color} />
      <Text style={[styles.toastText, { color }]}>{message}</Text>
    </Animated.View>
  );
}

function ShareSheetAction({
  theme, icon, label, busy, onPress,
}: {
  theme: { text: string; surface: string; background: string; border: string };
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.action}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`share-profile-action-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <View style={[styles.actionCircle, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {busy ? <ActivityIndicator color={theme.text} /> : <Feather name={icon} size={20} color={theme.text} />}
      </View>
      <Text style={[styles.actionLabel, { color: theme.text }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
  },
  headerSpacer: { width: 34 },
  title: { fontFamily: FONT.bold, fontSize: FS.md },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.xxl, gap: SP.md, paddingHorizontal: SP.lg },
  errorText: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  retryText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  carousel: { paddingHorizontal: SP.lg, paddingTop: SP.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: SP.md },
  dot: { width: 6, height: 6, borderRadius: 3 },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
  },
  action: { width: 72, alignItems: 'center', gap: 7 },
  actionCircle: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  actionLabel: { fontFamily: FONT.medium, fontSize: FS.xs, textAlign: 'center' },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SP.md, paddingVertical: SP.sm,
  },
  toastText: { fontSize: FS.sm, fontFamily: FONT.medium },
});

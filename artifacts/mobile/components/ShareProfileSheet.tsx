/**
 * Share Profile — full-screen page opened from the "Share profile" action on
 * both the buyer and seller profile screens (same component, same props,
 * for all three call sites: app/(buyer)/profile.tsx, app/seller-profile.tsx,
 * app/(tabs)/profile.tsx).
 *
 * This is a 1:1 layout match of the Mobbin "Share profile" flow reference
 * (Instagram, https://mobbin.com/flows/6e9d4c03-bb6d-4434-ad64-b2b53391ea9f),
 * skinned in Brandthread's monochrome brand instead of Instagram's colorful
 * gradients:
 *   - X top-left closes back to the profile.
 *   - A style pill top-center cycles three background variants on tap:
 *     COLOR (monochrome gradient), EMOJI (tiled Brandthread glyph pattern),
 *     SELFIE (the signed-in user's own photo, blurred full-bleed).
 *   - A scan-QR icon top-right opens a full-screen QR scanner
 *     (components/ShareProfileQrScanner.tsx, matching the Mobbin QR-scanner
 *     reference https://mobbin.com/flows/3fecc679-85bc-4a28-a356-a9239118872a)
 *     that navigates to a scanned user's profile.
 *   - A centered white rounded card holds a real, scannable QR code encoding
 *     the same canonical deep link used everywhere else in the app
 *     (lib/shareProfile.ts `buildCanonicalProfileUrl`, resolved by
 *     app/u/[username].tsx both in-app and on the web), with the Brandthread
 *     mark in the QR's center and "@handle" beneath it.
 *   - Three equal tiles below: Share profile, Copy link, Download — each
 *     reusing the app's existing share/clipboard/capture utilities.
 *
 * Only the background and card content change between variants; the header
 * chrome, card and tiles are structurally identical across all three, same
 * as the Mobbin reference's COLOR vs. EMOJI screenshots.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Image, Modal, Platform, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';

import { FONT, FS, SP, RADIUS, ICON, SUCCESS, RED } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticToggle, hapticLight, hapticSuccess } from '@/lib/haptics';
import { buildCanonicalProfileUrl, normalizeUsername, shareLinkWithFallback } from '@/lib/shareProfile';
import { captureCardAtNaturalSize, saveCardImageToLibrary, triggerWebImageDownload } from '@/lib/shareCard';
import { LOGO_SOURCE } from '@/constants/branding';
import { ShareProfileQrScanner } from '@/components/ShareProfileQrScanner';

// Lazy: keeps react-native-svg's QR codegen out of every screen that merely
// imports ShareProfileSheet (mirrors the pattern in ShareCardFrame.tsx).
const QRCode = React.lazy(() => import('react-native-qrcode-svg'));

const QR_CARD_SIZE = 240;
const QR_SIZE = 200;

type BackgroundVariant = 'color' | 'emoji' | 'selfie';
const VARIANTS: BackgroundVariant[] = ['color', 'emoji', 'selfie'];
const VARIANT_LABEL: Record<BackgroundVariant, string> = {
  color: 'COLOR', emoji: 'EMOJI', selfie: 'SELFIE',
};

interface BuyerExtra {
  statLabel: string;
  statValue: number;
  topPosts: { id: string; uri?: string }[];
}

interface SellerExtra {
  rating: { avgRating: number; totalCount: number } | null;
  products: { id: string; uri?: string }[];
}

interface ShareProfileSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Avatar/logo image the caller already has loaded — api.auth.me() doesn't return one. Doubles as the SELFIE background source. */
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

type BusyAction = 'share' | 'copy' | 'download' | null;

export function ShareProfileSheet({ visible, onClose, avatarUrl }: ShareProfileSheetProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const router = useRouter();
  const topInset = useHeaderTopInset();

  const [identity, setIdentity] = useState<OwnIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [variant, setVariant] = useState<BackgroundVariant>('color');
  const [screen, setScreen] = useState<'share' | 'scanner'>('share');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean; variant: 'success' | 'error' }>({
    message: '', visible: false, variant: 'success',
  });

  const cardRef = useRef<View | null>(null);
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
    setScreen('share');
    setVariant('color');
    void load();
  }, [visible, load]);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const showToast = useCallback((message: string, variantKind: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, visible: true, variant: variantKind });
    toastTimerRef.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 2200);
  }, []);

  const normalizedUsername = normalizeUsername(identity?.username);
  const canonicalUrl = buildCanonicalProfileUrl(identity?.username);
  const handle = normalizedUsername ? `@${normalizedUsername}` : '';
  const shareName = identity?.brandName || identity?.displayName || null;

  const runAction = useCallback(async (action: Exclude<BusyAction, null>, fn: () => Promise<void>) => {
    setBusy(action);
    try {
      await fn();
    } catch {
      showToast("Couldn't complete that. Try again.", 'error');
    } finally {
      setBusy(null);
    }
  }, [showToast]);

  const handleCyclePill = useCallback(() => {
    hapticToggle();
    setVariant(v => VARIANTS[(VARIANTS.indexOf(v) + 1) % VARIANTS.length]);
  }, []);

  const handleOpenScanner = useCallback(() => {
    hapticLight();
    setScreen('scanner');
  }, []);

  const handleCloseScanner = useCallback(() => {
    setScreen('share');
  }, []);

  const handleShareProfile = useCallback(() => {
    if (!canonicalUrl || busy) return;
    void runAction('share', async () => {
      hapticLight();
      const { Share } = await import('react-native');
      const result = await shareLinkWithFallback({
        url: canonicalUrl,
        message: shareName ? `${shareName} on Brandthread` : 'Find me on Brandthread',
        platformOS: Platform.OS,
        nativeShare: (content) => Share.share(content),
        webNavigator: typeof navigator !== 'undefined' ? (navigator as any) : null,
      });
      if (result === 'copied') showToast('Link copied');
      else if (result === 'unavailable') showToast("Sharing isn't available here. Use Copy link.", 'error');
    });
  }, [busy, canonicalUrl, runAction, shareName, showToast]);

  const handleCopyLink = useCallback(() => {
    if (!canonicalUrl || busy) return;
    void runAction('copy', async () => {
      hapticSuccess();
      if (Platform.OS === 'web') {
        if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(canonicalUrl);
      } else {
        const Clipboard = await import('expo-clipboard');
        await Clipboard.setStringAsync(canonicalUrl);
      }
      showToast('Link copied');
    });
  }, [busy, canonicalUrl, runAction, showToast]);

  const handleDownload = useCallback(() => {
    if (busy || !cardRef.current) return;
    void runAction('download', async () => {
      hapticLight();
      const uri = await captureCardAtNaturalSize({ current: cardRef.current }, QR_CARD_SIZE);
      if (Platform.OS === 'web') {
        triggerWebImageDownload(uri, `${normalizedUsername || 'brandthread'}-qr.png`);
        showToast('Downloaded');
      } else {
        const result = await saveCardImageToLibrary(uri);
        if (result.ok) showToast('Saved to Photos');
        else showToast('Enable Photos access to save this.', 'error');
      }
    });
  }, [busy, normalizedUsername, runAction, showToast]);

  if (!visible) return null;

  return (
    <Modal
      visible
      animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
      onRequestClose={screen === 'scanner' ? handleCloseScanner : onClose}
      presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
    >
      {screen === 'scanner' ? (
        <ShareProfileQrScanner onClose={handleCloseScanner} />
      ) : (
        <View style={styles.root}>
          <ShareBackground variant={variant} avatarUrl={avatarUrl ?? null} />

          <View style={[styles.headerRow, { top: topInset + SP.sm }]}>
            <PressableScale
              onPress={onClose}
              style={styles.headerIcon}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="share-profile-close"
              noMinHeight
            >
              <Feather name="x" size={ICON.md} color={theme.text} />
            </PressableScale>

            <PressableScale
              onPress={handleCyclePill}
              style={styles.pill}
              accessibilityRole="button"
              accessibilityLabel={`Background style: ${VARIANT_LABEL[variant]}. Tap to change.`}
              testID="share-profile-style-pill"
              noMinHeight
            >
              <Text style={[styles.pillText, { color: theme.text }]}>{VARIANT_LABEL[variant]}</Text>
            </PressableScale>

            <PressableScale
              onPress={handleOpenScanner}
              style={styles.headerIcon}
              accessibilityRole="button"
              accessibilityLabel="Scan QR code"
              testID="share-profile-scan"
              noMinHeight
            >
              <Feather name="maximize" size={ICON.md} color={theme.text} />
            </PressableScale>
          </View>

          <View style={styles.contentWrap}>
          <View style={styles.centerWrap}>
            {loading ? (
              <View style={[styles.card, { alignItems: 'center', justifyContent: 'center' }]}>
                <Feather name="loader" size={24} color="#0A0A0B" />
              </View>
            ) : error ? (
              <View style={[styles.card, styles.stateCard]}>
                <Feather name="wifi-off" size={28} color="#0A0A0B" />
                <Text style={styles.stateText}>Couldn't load profile</Text>
                <PressableScale onPress={load} accessibilityRole="button" accessibilityLabel="Retry">
                  <Text style={styles.retryText}>Retry</Text>
                </PressableScale>
              </View>
            ) : !normalizedUsername || !canonicalUrl ? (
              <View style={[styles.card, styles.stateCard]}>
                <Feather name="at-sign" size={28} color="#0A0A0B" />
                <Text style={styles.stateText}>Set a username to get a shareable QR code.</Text>
              </View>
            ) : (
              <>
                <View ref={cardRef} collapsable={false} style={styles.card} testID="share-profile-qr-card">
                  <React.Suspense fallback={null}>
                    <QRCode
                      value={canonicalUrl}
                      size={QR_SIZE}
                      backgroundColor="#FFFFFF"
                      color="#0A0A0B"
                      logo={LOGO_SOURCE}
                      logoSize={QR_SIZE * 0.2}
                      logoBackgroundColor="#FFFFFF"
                      logoBorderRadius={8}
                      logoMargin={4}
                      quietZone={12}
                    />
                  </React.Suspense>
                </View>
                <View style={styles.handlePill}>
                  <Text style={[styles.handleText, { color: theme.text }]} numberOfLines={1}>{handle}</Text>
                </View>
              </>
            )}
          </View>

          {!loading && !error && normalizedUsername && canonicalUrl && (
            <View style={styles.tilesRow}>
              <ShareTile
                icon="share"
                label="Share profile"
                busy={busy === 'share'}
                onPress={handleShareProfile}
                textColor={theme.text}
              />
              <ShareTile
                icon={busy === 'copy' ? 'check' : 'link-2'}
                label="Copy link"
                busy={busy === 'copy'}
                onPress={handleCopyLink}
                textColor={theme.text}
              />
              <ShareTile
                icon="download"
                label="Download"
                busy={busy === 'download'}
                onPress={handleDownload}
                textColor={theme.text}
              />
            </View>
          )}
          </View>

          <View pointerEvents="none" style={[styles.toastWrap, { bottom: insets.bottom + 96 }]}>
            <ShareToast message={toast.message} visible={toast.visible} variant={toast.variant} />
          </View>
        </View>
      )}
    </Modal>
  );
}

// ─── Backgrounds ────────────────────────────────────────────────────────────

/** Fixed monochrome gradient — grayscale/tonal, never Instagram's warm color. */
const COLOR_GRADIENT = ['#050506', '#1C1C20', '#54545C'] as const;

function ShareBackground({ variant, avatarUrl }: { variant: BackgroundVariant; avatarUrl: string | null }) {
  if (variant === 'selfie' && avatarUrl) {
    return (
      <View style={StyleSheet.absoluteFill}>
        <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} blurRadius={Platform.OS === 'android' ? 18 : 0} resizeMode="cover" />
        {Platform.OS !== 'android' && (
          <BlurView intensity={55} tint="dark" style={StyleSheet.absoluteFill} />
        )}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
      </View>
    );
  }
  if (variant === 'emoji') {
    return <EmojiPatternBackground />;
  }
  return (
    <LinearGradient
      colors={COLOR_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

/** Repeating tiled pattern of the Brandthread glyph — the app's own brand
 * mark standing in for Instagram's smiley-emoji tile, at low opacity over a
 * near-black field so the QR card still reads clearly on top. */
function EmojiPatternBackground() {
  const { width, height } = useWindowDimensions();
  const tile = 56;
  const cols = Math.ceil(width / tile) + 2;
  const rows = Math.ceil(height / tile) + 2;
  const glyphs = useMemo(() => {
    const items: { key: string; left: number; top: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const offset = r % 2 === 0 ? 0 : tile / 2;
        items.push({ key: `${r}-${c}`, left: c * tile + offset - tile, top: r * tile - tile });
      }
    }
    return items;
  }, [cols, rows]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0B0B0D', overflow: 'hidden' }]}>
      {glyphs.map(g => (
        <Image
          key={g.key}
          source={LOGO_SOURCE}
          style={{
            position: 'absolute', left: g.left, top: g.top,
            width: 22, height: 22, opacity: 0.16, transform: [{ rotate: '-12deg' }],
            tintColor: '#FFFFFF',
          }}
          resizeMode="contain"
        />
      ))}
    </View>
  );
}

// ─── Small pieces ───────────────────────────────────────────────────────────

function ShareToast({ message, visible, variant }: { message: string; visible: boolean; variant: 'success' | 'error' }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 150, useNativeDriver: true }).start();
  }, [visible, opacity]);
  const color = variant === 'success' ? SUCCESS : RED;
  return (
    <Animated.View style={[styles.toast, { opacity, borderColor: `${color}44` }]}>
      <Feather name={variant === 'success' ? 'check-circle' : 'alert-circle'} size={ICON.sm} color={color} />
      <Text style={[styles.toastText, { color }]}>{message}</Text>
    </Animated.View>
  );
}

function ShareTile({
  icon, label, busy, onPress, textColor,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  busy?: boolean;
  onPress: () => void;
  textColor: string;
}) {
  return (
    // The flex:1 that makes the three tiles divide the row evenly has to
    // live on this wrapping View, not on PressableScale's own `style` prop:
    // when that prop is a plain object (not a function) PressableScale
    // applies it to its *inner* Animated.View, not the outer Pressable that
    // actually participates in tilesRow's flex layout — so a bare `flex: 1`
    // there silently did nothing and the three labels ran together with no
    // spacing between them.
    <View style={styles.tileFlex}>
      <PressableScale
        style={styles.tile}
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={`share-profile-tile-${label.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <View style={styles.tileIconCircle}>
          <Feather name={icon} size={20} color={textColor} />
        </View>
        <Text style={[styles.tileLabel, { color: textColor }]} numberOfLines={1}>{label}</Text>
      </PressableScale>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0B' },
  headerRow: {
    position: 'absolute',
    left: SP.md,
    right: SP.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pill: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pillText: {
    color: '#FFFFFF',
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 1.2,
  },
  contentWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  centerWrap: {
    alignItems: 'center',
    gap: SP.md,
    paddingHorizontal: SP.lg,
    width: '100%',
  },
  card: {
    width: QR_CARD_SIZE,
    height: QR_CARD_SIZE,
    borderRadius: RADIUS.xl,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
  },
  stateCard: { paddingHorizontal: SP.lg, gap: SP.sm },
  stateText: { fontFamily: FONT.medium, fontSize: FS.sm, color: '#0A0A0B', textAlign: 'center' },
  retryText: { fontFamily: FONT.bold, fontSize: FS.sm, color: '#0A0A0B', textDecorationLine: 'underline' },
  handlePill: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  handleText: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  tilesRow: {
    flexDirection: 'row',
    width: '100%',
    paddingHorizontal: SP.lg,
    marginTop: SP.lg,
  },
  tileFlex: { flex: 1 },
  tile: {
    alignItems: 'center',
    gap: SP.xs,
  },
  tileIconCircle: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  tileLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: '#FFFFFF',
  },
  toastWrap: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    backgroundColor: '#18181B',
  },
  toastText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
});

/**
 * Drop waitlist — the seller side of brandthread.app/@handle/drop.
 * Pushed from Edit drop (seller-drop-create.tsx, edit mode) with ?dropId=.
 *
 *   Public page link    copy / share the page that collects phone numbers
 *   Text blast          one-tap "drop is live" SMS to the waitlist (once per drop)
 *   Countdown Story     9:16 card → system share sheet (link copied for a
 *                       link sticker), or PNG download on web
 *
 * Flow references (Mobbin):
 *   Text blast — Partiful "Creating a text blast": To (audience + count) →
 *     message → Send → "Sent to …" row.
 *     https://mobbin.com/flows/289aa169-18bd-41c2-8681-576782bc4af2
 *   Countdown Story — Instagram "Share profile": card preview above a row of
 *     Share / Copy link / Download tiles.
 *     https://mobbin.com/flows/6e9d4c03-bb6d-4434-ad64-b2b53391ea9f
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, Share, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi, type DropSmsBlastPreview } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionError } from '@/components/InlineFeedback';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui/Button';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { CenteredToast } from '@/components/social/CenteredToast';
import { DropCountdownShareCard } from '@/components/share-cards/DropCountdownShareCard';
import { isPreviewDemoMode } from '@/lib/devPreview';
import {
  STORY_CARD_HEIGHT, STORY_CARD_WIDTH, captureShareCard, shareCardToInstagramStories, shareStoryCardImage, triggerWebImageDownload,
} from '@/lib/shareCard';
import {
  displayUrl, dropCountdownLabel, dropLaunchLabel, peopleLabel, smsBlastBlockReason,
} from '@/lib/dropWaitlist';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

type Theme = ReturnType<typeof useAppTheme>['theme'];

const DEMO_PREVIEW: DropSmsBlastPreview = {
  drop: {
    id: 'demo-drop',
    name: 'Summer Capsule',
    status: 'active',
    releaseAt: new Date(Date.now() + (2 * 24 + 4) * 3600_000).toISOString(),
    heroImageUrl: null,
    launchTimezone: 'America/New_York',
  },
  brandName: 'Demo Studio',
  handle: 'demostudio',
  publicUrl: 'https://brandthread.app/@demostudio/drop',
  waitlistCount: 128,
  smsConfigured: false,
  dropLive: false,
  message: 'Demo Studio: Summer Capsule is live. Shop now: https://brandthread.app/drops/demo-drop Reply STOP to opt out.',
  blast: null,
};

function sentAtLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export default function DropWaitlistScreen() {
  const { dropId } = useLocalSearchParams<{ dropId?: string }>();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [preview, setPreview] = useState<DropSmsBlastPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<View>(null);

  const showToast = useCallback((message: string, ms = 1800) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    if (isPreviewDemoMode()) {
      setPreview(DEMO_PREVIEW);
      setLoading(false);
      return;
    }
    if (!dropId) {
      setLoadError('This drop could not be found.');
      setLoading(false);
      return;
    }
    try {
      setPreview(await api.drops.smsBlastPreview(String(dropId)));
    } catch {
      setLoadError('Could not load the waitlist. Tap to retry.');
    } finally {
      setLoading(false);
    }
  }, [api, dropId]);

  useEffect(() => { load(); }, [load]);

  const publicUrl = preview?.publicUrl ?? null;
  const blockReason = preview ? smsBlastBlockReason(preview) : null;
  const countdown = dropCountdownLabel(preview?.drop.releaseAt);
  const launch = dropLaunchLabel(preview?.drop.releaseAt, preview?.drop.launchTimezone);

  async function copyLink(message = 'Link copied') {
    if (!publicUrl) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(publicUrl);
    showToast(message);
  }

  async function shareLink() {
    if (!publicUrl || !preview) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      await Share.share({ message: `Get a text when ${preview.drop.name} by ${preview.brandName} drops: ${publicUrl}`, url: publicUrl });
    } catch {
      await copyLink();
    }
  }

  async function sendBlast() {
    if (!preview || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await api.drops.smsBlast(preview.drop.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setConfirmOpen(false);
      const now = new Date().toISOString();
      setPreview((p) => p && ({
        ...p,
        blast: res.sent > 0 || res.recipients === 0
          ? { status: 'sent', recipientCount: res.recipients, sentCount: res.sent, failedCount: res.failed, createdAt: now, completedAt: now }
          : null,
      }));
      if (res.recipients > 0 && res.sent === 0) {
        setSendError('No texts could be delivered. Try again in a few minutes.');
      }
    } catch (err: any) {
      const code = err?.code as string | undefined;
      if (code === 'ALREADY_SENT') {
        setConfirmOpen(false);
        await load();
      } else if (code === 'SMS_NOT_CONFIGURED') {
        setPreview((p) => p && { ...p, smsConfigured: false });
        setConfirmOpen(false);
      } else if (code === 'DROP_NOT_LIVE') {
        setPreview((p) => p && { ...p, dropLive: false });
        setConfirmOpen(false);
      } else {
        setSendError('Could not send texts. Check your connection and try again.');
      }
    } finally {
      setSending(false);
    }
  }

  async function captureCard(): Promise<string> {
    if (Platform.OS === 'web') {
      const { captureRef } = await import('react-native-view-shot');
      return captureRef(cardRef, { format: 'png', quality: 1, result: 'data-uri', width: STORY_CARD_WIDTH, height: STORY_CARD_HEIGHT });
    }
    return captureShareCard(cardRef);
  }

  async function shareToStories() {
    if (sharing) return;
    setSharing(true);
    try {
      // Instagram's Link sticker takes a pasted URL, so copy it first.
      if (publicUrl) await Clipboard.setStringAsync(publicUrl);
      const uri = await captureCard();
      if (publicUrl) showToast('Link copied — paste it into a Link sticker', 2600);
      await shareCardToInstagramStories(uri);
    } catch {
      showToast('Could not create the Story image');
    } finally {
      setSharing(false);
    }
  }

  async function shareImage() {
    if (sharing) return;
    setSharing(true);
    try {
      const uri = await captureCard();
      if (Platform.OS === 'web') {
        triggerWebImageDownload(uri, `${preview?.handle ?? 'brandthread'}-drop-countdown.png`);
        showToast('Image downloaded');
      } else {
        if (publicUrl) await Clipboard.setStringAsync(publicUrl);
        await shareStoryCardImage(uri, `${preview?.handle ?? 'brandthread'}-drop-countdown.png`);
      }
    } catch {
      showToast('Could not create the Story image');
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title="Drop waitlist" />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.text} /></View>
      ) : loadError || !preview ? (
        <View style={{ padding: SP.md }}><SectionError message={loadError ?? 'Could not load the waitlist.'} onRetry={load} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SP.xl }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Public page */}
          <Text style={styles.sectionLabel}>Public page</Text>
          <View style={styles.card}>
            {publicUrl ? (
              <>
                <Text style={styles.url} numberOfLines={1} selectable>{displayUrl(publicUrl)}</Text>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Button label="Copy link" icon="copy" variant="secondary" size="small" fullWidth onPress={() => copyLink()} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Share" icon="share" variant="secondary" size="small" fullWidth onPress={shareLink} />
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.muted}>Set a username in Edit profile to get your public drop page.</Text>
            )}
          </View>

          <View style={styles.countCard}>
            <Text style={styles.countValue}>{preview.waitlistCount.toLocaleString('en-US')}</Text>
            <Text style={styles.muted}>{preview.waitlistCount === 1 ? 'person on your text waitlist' : 'people on your text waitlist'}</Text>
          </View>

          {/* Text blast */}
          <Text style={styles.sectionLabel}>Text blast</Text>
          <View style={styles.card}>
            <View style={styles.toRow}>
              <Text style={styles.fieldLabel}>To</Text>
              <View style={styles.chip}>
                <Feather name="message-square" size={13} color={theme.text} />
                <Text style={styles.chipText}>Waitlist · {preview.waitlistCount.toLocaleString('en-US')}</Text>
              </View>
            </View>
            <Text style={[styles.fieldLabel, { marginTop: SP.md }]}>Message</Text>
            <View style={styles.messageBox}>
              <Text style={styles.messageText}>{preview.message}</Text>
            </View>

            {preview.blast ? (
              <View style={styles.sentRow}>
                <Feather name="check-circle" size={16} color={theme.text} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sentTitle}>Sent to {peopleLabel(preview.blast.sentCount)}</Text>
                  <Text style={styles.muted}>
                    {sentAtLabel(preview.blast.completedAt ?? preview.blast.createdAt)}
                    {preview.blast.failedCount > 0 ? ` · ${preview.blast.failedCount} not delivered` : ''}
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <Button
                  label="Text waitlist — drop is live"
                  icon="send"
                  onPress={() => { setSendError(null); setConfirmOpen(true); }}
                  disabled={!!blockReason}
                  fullWidth
                  style={{ marginTop: SP.md }}
                  testID="sms-blast-button"
                />
                {blockReason ? <Text style={[styles.muted, styles.reason]}>{blockReason}</Text> : null}
              </>
            )}
            {sendError && !confirmOpen ? <Text style={[styles.error, styles.reason]}>{sendError}</Text> : null}
          </View>

          {/* Countdown Story */}
          <Text style={styles.sectionLabel}>Countdown Story</Text>
          <View style={styles.storyWrap}>
            <View collapsable={false}>
              <DropCountdownShareCard
                ref={cardRef}
                theme={theme}
                qrValue={publicUrl}
                data={{
                  brandName: preview.brandName,
                  dropName: preview.drop.name,
                  heroUri: preview.drop.heroImageUrl,
                  countdownLabel: countdown,
                  launchLabel: launch,
                  linkLabel: publicUrl ? displayUrl(publicUrl) : null,
                }}
              />
            </View>
            <View style={styles.tiles}>
              {Platform.OS !== 'web' ? (
                <Tile styles={styles} theme={theme} icon="instagram" label="Story" onPress={shareToStories} disabled={sharing} />
              ) : null}
              <Tile
                styles={styles}
                theme={theme}
                icon={Platform.OS === 'web' ? 'download' : 'share'}
                label={Platform.OS === 'web' ? 'Download' : 'More'}
                onPress={shareImage}
                disabled={sharing}
              />
            </View>
          </View>
        </ScrollView>
      )}

      <BottomSheet visible={confirmOpen} onClose={() => { if (!sending) setConfirmOpen(false); }}>
        {preview ? (
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Text {peopleLabel(preview.waitlistCount)}?</Text>
            <Text style={styles.muted}>Each number gets this message once. This can’t be undone.</Text>
            <View style={[styles.messageBox, { marginTop: SP.md }]}>
              <Text style={styles.messageText}>{preview.message}</Text>
            </View>
            {sendError ? <Text style={[styles.error, styles.reason]}>{sendError}</Text> : null}
            <Button label={`Send ${preview.waitlistCount.toLocaleString('en-US')} texts`} onPress={sendBlast} loading={sending} fullWidth style={{ marginTop: SP.md }} testID="sms-blast-confirm" />
            <Button label="Cancel" variant="secondary" onPress={() => setConfirmOpen(false)} disabled={sending} fullWidth style={{ marginTop: SP.sm }} />
          </View>
        ) : null}
      </BottomSheet>
      <CenteredToast message={toast} />
    </View>
  );
}

function Tile({ styles, theme, icon, label, onPress, disabled }: {
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <PressableScale style={[styles.tile, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
        <Feather name={icon} size={20} color={theme.text} />
        <Text style={styles.tileLabel}>{label}</Text>
      </PressableScale>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  sectionLabel: {
    fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: SP.lg, marginBottom: SP.sm,
  },
  card: { backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, padding: SP.md },
  url: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, marginBottom: SP.md },
  row: { flexDirection: 'row', gap: SP.sm },
  muted: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18 },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },
  reason: { marginTop: SP.sm, textAlign: 'center' },
  countCard: {
    marginTop: SP.sm, backgroundColor: theme.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border,
    paddingVertical: SP.md, alignItems: 'center',
  },
  countValue: { fontSize: FS.h1, fontFamily: FONT.bold, color: theme.text },
  toRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.cardElevated, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 6,
  },
  chipText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  messageBox: {
    marginTop: SP.sm, backgroundColor: theme.cardElevated, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.md,
  },
  messageText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 18 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md },
  sentTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  storyWrap: { alignItems: 'center', gap: SP.md },
  tiles: { flexDirection: 'row', gap: SP.sm, alignSelf: 'stretch' },
  tile: {
    alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: SP.md,
    backgroundColor: theme.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
  },
  tileLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },
  sheet: { paddingHorizontal: SP.md, paddingBottom: SP.md },
  sheetTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text, marginBottom: SP.xs },
});

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { ShareCardFrame } from './ShareCardFrame';

export interface DropCountdownShareCardData {
  brandName: string;
  dropName: string;
  heroUri: string | null;
  /** "Drops in 2d 4h" / "Live now" */
  countdownLabel: string | null;
  /** "Sat, Oct 18 · 7:00 PM EDT" */
  launchLabel: string | null;
  /** "brandthread.app/@handle/drop" */
  linkLabel: string | null;
}

interface DropCountdownShareCardProps {
  theme: AppThemePreset;
  data: DropCountdownShareCardData;
  qrValue: string | null;
}

/**
 * 9:16 Story card for a drop countdown (captured at 1080x1920 via
 * lib/shareCard.ts). Countdown block reference (Mobbin): Instagram Stories
 * countdown sticker — title above a boxed time readout.
 */
export const DropCountdownShareCard = React.forwardRef<View, DropCountdownShareCardProps>(
  function DropCountdownShareCard({ theme, data, qrValue }, ref) {
    const styles = React.useMemo(() => makeStyles(theme), [theme]);
    const label = data.countdownLabel ?? null;
    const counting = !!label && label.startsWith('Drops in ');
    const value = counting ? 'DROPS IN' : null;
    const big = counting ? label!.slice('Drops in '.length) : label;

    return (
      <ShareCardFrame ref={ref} theme={theme} qrValue={qrValue}>
        <Text style={styles.brand} numberOfLines={1}>{data.brandName.toUpperCase()}</Text>
        {data.heroUri ? (
          <View style={styles.hero}>
            <Image source={{ uri: data.heroUri }} style={styles.heroImg} />
          </View>
        ) : null}
        <Text style={styles.dropName} numberOfLines={2}>{data.dropName}</Text>
        {big ? (
          <View style={styles.sticker}>
            {value ? <Text style={styles.stickerTitle}>{value}</Text> : null}
            <Text style={styles.stickerValue} numberOfLines={1}>{big}</Text>
            {data.launchLabel ? <Text style={styles.stickerSub} numberOfLines={1}>{data.launchLabel}</Text> : null}
          </View>
        ) : null}
        {data.linkLabel ? <Text style={styles.link} numberOfLines={1}>{data.linkLabel}</Text> : null}
      </ShareCardFrame>
    );
  },
);

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  brand: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 2, color: theme.text, marginBottom: SP.sm },
  hero: {
    width: 168,
    height: 168,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: theme.cardElevated,
    borderWidth: 1,
    borderColor: theme.border,
  },
  heroImg: { width: '100%', height: '100%' },
  dropName: { fontFamily: FONT.bold, fontSize: FS.lg, color: theme.text, textAlign: 'center', marginTop: SP.md },
  sticker: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.md,
    backgroundColor: theme.text,
  },
  stickerTitle: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1.5, color: theme.background },
  stickerValue: { fontFamily: FONT.bold, fontSize: FS.xxl, color: theme.background, fontVariant: ['tabular-nums'] },
  stickerSub: { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.background, marginTop: 2 },
  link: { fontFamily: FONT.semibold, fontSize: FS.xs, color: theme.muted, marginTop: SP.md },
});

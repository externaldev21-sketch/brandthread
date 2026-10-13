/**
 * Item 123: the prepaid return label in the app, with a QR code.
 *
 * Reference: H&M order details, "QR Code for in-store return" (Mobbin) —
 * a titled section, one line of instruction, the code, then the action.
 * Shown only when the seller bought a label (GET /api/returns/:id
 * `returnLabelUrl`, migration 241). The label provider (Shippo) gives a
 * label URL, not a carrier drop-off QR, so the code opens that label:
 * scanning it at a print-and-ship counter or on another device prints it.
 */
import React, { useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { BrandthreadCard } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { hapticLight } from '@/lib/haptics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export function isOpenableLabelUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https:\/\/\S+$/i.test(url.trim());
}

export function ReturnLabelCard({ labelUrl, carrier, trackingNumber }: {
  labelUrl: string | null | undefined;
  carrier?: string | null;
  trackingNumber?: string | null;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!isOpenableLabelUrl(labelUrl)) return null;
  const url = labelUrl.trim();
  const shipping = [carrier, trackingNumber].filter(Boolean).join(' · ');

  return (
    <BrandthreadCard>
      <Text style={s.title}>Return label</Text>
      <Text style={s.body}>Scan this code to open and print your prepaid label, then drop the package off with the carrier.</Text>
      {/* Scanners need dark modules on a light plate: every preset pairs a
          white `text` with a near-black `background`, so this holds in all 12. */}
      <View style={s.qrPlate} accessibilityRole="image" accessibilityLabel="QR code for your return label">
        <QRCode value={url} size={176} backgroundColor={theme.text} color={theme.background} />
      </View>
      {shipping ? <Text style={s.meta} numberOfLines={1} selectable>{shipping}</Text> : null}
      <Button
        label="Open label"
        variant="secondary"
        icon="external-link"
        fullWidth
        style={{ marginTop: SP.md }}
        onPress={() => { hapticLight(); void Linking.openURL(url).catch(() => {}); }}
        testID="return-label-open"
      />
    </BrandthreadCard>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  title: { fontFamily: FONT.semibold, fontSize: FS.sm, letterSpacing: 0.4, textTransform: 'uppercase', color: theme.muted, marginBottom: SP.sm },
  body: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, lineHeight: 20 },
  qrPlate: {
    alignSelf: 'center', marginTop: SP.md, padding: SP.md, borderRadius: RADIUS.md,
    // The light quiet zone around the QR code is part of the code.
    backgroundColor: theme.text,
  },
  meta: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted, textAlign: 'center', marginTop: SP.sm },
});

/**
 * Manufacturer directory card — the two-column tile used by the "Find a
 * manufacturer" category results (app/manufacturer-category.tsx). Moved out
 * of app/manufacturer-hub.tsx unchanged when the hub's Discover tab was
 * replaced by the find-by-category flow.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { CachedImage as Image } from '@/components/CachedImage';
import { Icon } from '@/components/ui/Icon';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import type { Manufacturer } from '@/services/manufacturerTypes';

// ─── Manufacturer Card ────────────────────────────────────────────────────────

export interface ManufacturerCardProps {
  mfg: Manufacturer;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  onMessage: () => void;
  onProfile: () => void;
  onQuote: () => void;
}

// Tap-area padding for the card's small controls (hitSlop is measured from
// inside a control's border). The heart sits 7pt from the cover's clipped
// top-right corner, so it extends further down/left instead; the 32pt quote
// button reaches out to the card edge on its left and only 3pt into the 4pt
// gap before "Chat now".
const CARD_SAVE_HIT_SLOP = { top: 7, right: 7, bottom: 9, left: 9 };
const CARD_QUOTE_HIT_SLOP = { top: 7, bottom: 7, left: 11, right: 3 };
const CARD_CHAT_HIT_SLOP = { top: 7, bottom: 7, left: 0, right: 0 };

export function ManufacturerCard({ mfg, saved, saving, onSave, onMessage, onProfile, onQuote }: ManufacturerCardProps) {
  const { theme } = useAppTheme();
  const card = useMemo(() => makeCard(theme), [theme]);
  return (
    <View style={card.root}>
      {/* Compact directory tile: image first, then the key sourcing details. */}
      <View style={card.cover}>
        <TouchableOpacity onPress={onProfile} activeOpacity={0.85} style={card.coverTouch} accessibilityRole="button" accessibilityLabel={`View ${mfg.name} profile`}>
          {mfg.profileImageUri ? (
            <Image cachePolicy="memory-disk" source={{ uri: mfg.profileImageUri }} style={card.coverImage} contentFit="cover" />
          ) : (
            <View style={card.coverFallback}>
              <Text style={card.coverFallbackText}>{mfg.name.charAt(0)}</Text>
            </View>
          )}
        </TouchableOpacity>
          {mfg.yearsInBusiness > 0 && (
            <View style={card.yearsBadge}>
              <Text style={card.yearsText}>{mfg.yearsInBusiness} {mfg.yearsInBusiness === 1 ? 'yr' : 'yrs'}</Text>
            </View>
          )}
          <TouchableOpacity
            style={card.saveOverlay}
            onPress={onSave}
            disabled={saving}
            activeOpacity={0.75}
            hitSlop={CARD_SAVE_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={saved ? `Remove ${mfg.name} from favorites` : `Add ${mfg.name} to favorites`}
          >
            <Icon name="heart" size={15} color={saved ? theme.error : theme.text} />
          </TouchableOpacity>
        </View>

      <View style={card.topRow}>
        <View style={card.nameCol}>
          <View style={card.nameRow}>
            <Text style={card.name} numberOfLines={2}>{mfg.name}</Text>
            {mfg.isVerified && (
              <View style={[card.verifiedBadge, { backgroundColor: theme.secondaryDim }]}>
                <Icon name="check-circle" size={11} color={theme.secondary} />
              </View>
            )}
          </View>
          <Text style={card.location} numberOfLines={2}>{[mfg.city, mfg.country].filter(Boolean).join(', ')}</Text>
          <View style={card.ratingRow}>
            <Icon name="star" size={12} color={theme.warning} />
            <Text style={card.ratingText}>{mfg.reviewCount > 0 ? mfg.rating.toFixed(1) : 'Not rated'}</Text>
            {mfg.reviewCount > 0 && <Text style={card.reviewCount}>({mfg.reviewCount})</Text>}
          </View>
        </View>
      </View>

      {/* Alibaba-style price-per-unit range + MOQ line, ahead of specialties. */}
      {mfg.unitPriceMinCents > 0 && (
        <Text style={card.priceRange} numberOfLines={1}>
          {mfg.unitPriceMinCents === mfg.unitPriceMaxCents
            ? formatCents(mfg.unitPriceMinCents)
            : `${formatCents(mfg.unitPriceMinCents)} – ${formatCents(mfg.unitPriceMaxCents)}`} <Text style={card.priceUnit}>/ unit</Text>
        </Text>
      )}
      <Text style={card.moqLine} numberOfLines={1}>Min. order: {mfg.moq > 0 ? `${mfg.moq.toLocaleString('en-US')} pieces` : 'on request'}</Text>
      <Text style={card.specialties} numberOfLines={2}>
        {(Array.isArray(mfg.specialties) ? mfg.specialties : []).slice(0, 3).join(' • ')}
      </Text>
      <View style={card.detailStack}>
        <Text style={card.stats} numberOfLines={1}>{mfg.leadTimeDays ? `${mfg.leadTimeDays}-day lead time` : 'Lead time varies'}</Text>
        <Text style={card.response} numberOfLines={1}>{mfg.responseTimeHours > 0 ? `Replies in ~${mfg.responseTimeHours}h` : 'Response time not provided'}</Text>
      </View>

      {/* Actions — "Chat now" primary, matching the Alibaba directory card. */}
      <View style={card.actionRow}>
        <TouchableOpacity
          style={card.iconAction}
          onPress={onQuote}
          activeOpacity={0.7}
          hitSlop={CARD_QUOTE_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`Request a quote from ${mfg.name}`}
        >
          <Icon name="file-text" size={15} color={theme.secondary} />
        </TouchableOpacity>
        <TouchableOpacity style={[card.profileBtn, { backgroundColor: theme.accent, borderColor: theme.accent }]} onPress={onMessage} activeOpacity={0.7} hitSlop={CARD_CHAT_HIT_SLOP} accessibilityRole="button">
          <Icon name="message-circle" size={ICON.sm} color={theme.onAccent} />
          <Text style={[card.profileBtnText, { color: theme.onAccent }]}>Chat now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeCard = (theme: AppThemePreset) => StyleSheet.create({
  root:          { flex: 1, minWidth: 0, backgroundColor: theme.cardGlass, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.border, marginBottom: SP.sm, padding: SP.sm },
  cover:         { height: 112, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: theme.accentDim, position: 'relative', marginBottom: SP.sm },
  coverTouch:    { flex: 1 },
  coverImage:    { width: '100%', height: '100%' },
  coverFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coverFallbackText: { fontSize: FS.h2, fontFamily: FONT.bold, color: theme.accentLight },
  yearsBadge:    { position: 'absolute', left: 7, bottom: 7, paddingHorizontal: 7, paddingVertical: 3, borderRadius: RADIUS.pill, backgroundColor: 'rgba(10,10,11,0.78)' }, // theme-exempt: scrim over the cover photo
  yearsText:     { fontSize: 11, fontFamily: FONT.semibold, color: '#FAFAFA' }, // theme-exempt: text on the photo scrim
  saveOverlay:   { position: 'absolute', top: 7, right: 7, width: 28, height: 28, borderRadius: 14, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },
  topRow:        { marginBottom: SP.xs },
  nameCol:       { flex: 1 },
  nameRow:       { flexDirection: 'row', alignItems: 'center', gap: SP.xs, flexWrap: 'wrap' },
  name:          { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, flex: 1 },
  verifiedBadge: { width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  verifiedText:  { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.secondary },
  location:      { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  ratingRow:     { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  ratingText:    { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.warning },
  reviewCount:   { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, fontVariant: ['tabular-nums'] },
  priceRange:    { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text, marginTop: 2 },
  priceUnit:     { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  moqLine:       { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, marginBottom: SP.xs },
  specialties:   { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, marginBottom: SP.xs, minHeight: 28 },
  detailStack:   { minHeight: 36, marginBottom: SP.sm },
  stats:         { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.text, marginBottom: 3 },
  response:      { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  actionRow:     { flexDirection: 'row', gap: SP.xs, alignItems: 'center' },
  iconAction:    { width: 32, height: 32, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  profileBtn:    { flex: 1, minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: RADIUS.sm, borderWidth: 1 },
  profileBtnText:{ fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.onAccent },
});

/**
 * Manufacturer Profile Screen
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_LIGHT,
  SUCCESS, BLUE, ORANGE, RED, GOLD, ON_DARK, GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM,
} from '@/lib/theme';

import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  FilterChip, StatusBadge, SectionHeader, EmptyState, FormInput,
} from '@/components/BrandthreadUI';

import {
  getManufacturer, getRelationship, saveManufacturer, unsaveManufacturer,
  getOrCreateConversation,
} from '@/services/manufacturerService';

import { Manufacturer, ManufacturerRelationship } from '@/services/manufacturerTypes';

// ─── Star Rating ──────────────────────────────────────────────────────────────

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Feather
          key={i}
          name={i <= Math.round(rating) ? 'star' : 'star'}
          size={size}
          color={i <= Math.round(rating) ? GOLD : SUBTLE}
        />
      ))}
    </View>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function Chip({ label, color = PURPLE_DIM, textColor = PURPLE_LIGHT }: { label: string; color?: string; textColor?: string }) {
  return (
    <View style={[s.chip, { backgroundColor: color, borderColor: color }]}>
      <Text style={[s.chipText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.sectionCard}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ─── Demo Reviews ─────────────────────────────────────────────────────────────

const DEMO_REVIEWS = [
  { id: 'r1', sellerName: 'Studio Mercer', rating: 5, qualityRating: 5, comment: 'Exceptional quality and communication throughout. Highly recommend.', createdAt: '2024-11-15' },
  { id: 'r2', sellerName: 'Arch Label', rating: 4, qualityRating: 4, comment: 'Great product, slightly delayed delivery but resolved professionally.', createdAt: '2024-10-08' },
  { id: 'r3', sellerName: 'Voss Apparel', rating: 5, qualityRating: 5, comment: 'Perfect stitching, on-time delivery, will order again.', createdAt: '2024-09-22' },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ManufacturerProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [manufacturer, setManufacturer] = useState<Manufacturer | null>(null);
  const [relationship, setRelationship] = useState<ManufacturerRelationship | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([getManufacturer(id), getRelationship(id)]).then(([mfg, rel]) => {
      setManufacturer(mfg ?? null);
      setRelationship(rel);
      setSaved(!!rel);
      setLoading(false);
    });
  }, [id]);

  async function handleSave() {
    if (!id || actionLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionLoading(true);
    try {
      if (saved) {
        await unsaveManufacturer(id);
        setSaved(false);
      } else {
        await saveManufacturer(id);
        setSaved(true);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleMessage() {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const conv = await getOrCreateConversation(id, { contextLabel: 'General' });
    router.push(('/manufacturer-messages?conversationId=' + conv.id) as never);
  }

  function handleQuote() {
    router.push(('/quote-request?manufacturerId=' + id) as never);
  }

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  if (!manufacturer) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <EmptyState icon="alert-circle" title="Manufacturer not found" description="This manufacturer profile could not be loaded." />
      </View>
    );
  }

  const m = manufacturer;

  return (
    <View style={[s.root, { paddingTop: 0 }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        stickyHeaderIndices={[0]}
      >
        {/* ── Sticky Hero ── */}
        <LinearGradient
          colors={['#1a0a2e', '#0a1628', '#07070F']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[s.hero, { paddingTop: insets.top + SP.sm }]}
        >
          {/* Back button */}
          <TouchableOpacity onPress={() => router.back()} style={s.backBtnHero} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="arrow-left" size={ICON.md} color={ON_DARK} />
          </TouchableOpacity>

          {/* Factory icon */}
          <View style={s.factoryIconWrap}>
            <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.factoryIconBg}>
              <Feather name="settings" size={ICON.xxl} color={ON_DARK} />
            </LinearGradient>
          </View>

          {/* Name + verified */}
          <View style={s.heroNameRow}>
            <Text style={s.heroName}>{m.name}</Text>
            {m.isVerified && (
              <View style={s.verifiedBadge}>
                <Feather name="check-circle" size={14} color={CYAN} />
                <Text style={s.verifiedText}>Verified</Text>
              </View>
            )}
          </View>

          {/* Location */}
          <View style={s.heroLocationRow}>
            <Feather name="map-pin" size={12} color={MUTED} />
            <Text style={s.heroLocation}>{m.city}, {m.country}</Text>
          </View>

          {/* Rating */}
          <View style={s.heroRatingRow}>
            <StarRating rating={m.rating} />
            <Text style={s.heroRatingText}>{m.rating.toFixed(1)} ({m.reviewCount} reviews)</Text>
          </View>
        </LinearGradient>

        {/* ── Quick Actions ── */}
        <View style={s.quickActions}>
          <TouchableOpacity onPress={handleSave} style={s.qaBtn} activeOpacity={0.8}>
            <Feather name="heart" size={ICON.md} color={saved ? RED : MUTED} />
            <Text style={[s.qaBtnLabel, saved && { color: RED }]}>{saved ? 'Saved' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleMessage} style={s.qaBtn} activeOpacity={0.8}>
            <Feather name="message-circle" size={ICON.md} color={CYAN} />
            <Text style={[s.qaBtnLabel, { color: CYAN }]}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleQuote} style={s.qaBtn} activeOpacity={0.8}>
            <Feather name="file-text" size={ICON.md} color={PURPLE_LIGHT} />
            <Text style={[s.qaBtnLabel, { color: PURPLE_LIGHT }]}>Quote</Text>
          </TouchableOpacity>
        </View>

        <View style={s.content}>
          {/* ── Overview ── */}
          <SectionCard title="Overview">
            <View style={s.overviewGrid}>
              <View style={s.overviewItem}>
                <Feather name="clock" size={ICON.sm} color={PURPLE_LIGHT} />
                <Text style={s.overviewLabel}>Years in Business</Text>
                <Text style={s.overviewValue}>{m.yearsInBusiness}</Text>
              </View>
              <View style={s.overviewItem}>
                <Feather name="users" size={ICON.sm} color={CYAN} />
                <Text style={s.overviewLabel}>Team Size</Text>
                <Text style={s.overviewValue}>{m.teamSize}</Text>
              </View>
              <View style={s.overviewItem}>
                <Feather name="package" size={ICON.sm} color={SUCCESS} />
                <Text style={s.overviewLabel}>Capacity</Text>
                <Text style={s.overviewValue}>{m.productionCapacity}</Text>
              </View>
              <View style={s.overviewItem}>
                <Feather name="zap" size={ICON.sm} color={GOLD} />
                <Text style={s.overviewLabel}>Response</Text>
                <Text style={s.overviewValue}>{m.responseTimeHours}h</Text>
              </View>
              <View style={s.overviewItem}>
                <Feather name="calendar" size={ICON.sm} color={ORANGE} />
                <Text style={s.overviewLabel}>Lead Time</Text>
                <Text style={s.overviewValue}>{m.leadTimeDays}d</Text>
              </View>
            </View>
            {!!m.description && <Text style={s.description}>{m.description}</Text>}
          </SectionCard>

          {/* ── Categories ── */}
          {m.categories.length > 0 && (
            <SectionCard title="Categories">
              <View style={s.chipRow}>
                {m.categories.map(c => <Chip key={c} label={c} />)}
              </View>
            </SectionCard>
          )}

          {/* ── Specialties ── */}
          {m.specialties.length > 0 && (
            <SectionCard title="Specialties">
              <View style={s.chipRow}>
                {m.specialties.map(s2 => <Chip key={s2} label={s2} color={'rgba(34,211,238,0.12)'} textColor={CYAN_LIGHT} />)}
              </View>
            </SectionCard>
          )}

          {/* ── Capabilities ── */}
          {m.capabilities.length > 0 && (
            <SectionCard title="Capabilities">
              {m.capabilities.map(cap => (
                <View key={cap.id} style={s.capabilityBlock}>
                  <Text style={s.capabilityCategory}>{cap.category}</Text>
                  {cap.materials.length > 0 && (
                    <View>
                      <Text style={s.capSubLabel}>Materials</Text>
                      <View style={s.chipRow}>
                        {cap.materials.map(mat => <Chip key={mat} label={mat} color={CARD_ELEVATED} textColor={MUTED} />)}
                      </View>
                    </View>
                  )}
                  {cap.printMethods && cap.printMethods.length > 0 && (
                    <View style={{ marginTop: SP.sm }}>
                      <Text style={s.capSubLabel}>Print Methods</Text>
                      <View style={s.chipRow}>
                        {cap.printMethods.map(pm => <Chip key={pm} label={pm} color={PURPLE_DIM} textColor={PURPLE_LIGHT} />)}
                      </View>
                    </View>
                  )}
                </View>
              ))}
            </SectionCard>
          )}

          {/* ── Certifications ── */}
          {m.certifications.length > 0 && (
            <SectionCard title="Certifications">
              {m.certifications.map(cert => (
                <View key={cert.id} style={s.certRow}>
                  <View style={s.certIcon}>
                    <Feather name="award" size={ICON.sm} color={GOLD} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.certName}>{cert.name}</Text>
                    {cert.issuer && <Text style={s.certMeta}>Issued by {cert.issuer}</Text>}
                    {cert.validUntil && <Text style={s.certMeta}>Valid until {cert.validUntil}</Text>}
                  </View>
                  <StatusBadge label="Active" variant="success" small />
                </View>
              ))}
            </SectionCard>
          )}

          {/* ── Materials ── */}
          {m.materials.length > 0 && (
            <SectionCard title="Materials">
              <View style={s.chipRow}>
                {m.materials.map(mat => <Chip key={mat} label={mat} color={CARD_ELEVATED} textColor={FG} />)}
              </View>
            </SectionCard>
          )}

          {/* ── Pricing ── */}
          <SectionCard title="Pricing">
            <View style={s.pricingGrid}>
              <View style={s.pricingItem}>
                <Text style={s.pricingLabel}>MOQ</Text>
                <Text style={s.pricingValue}>{m.moq} units</Text>
              </View>
              <View style={s.pricingItem}>
                <Text style={s.pricingLabel}>Unit Price</Text>
                <Text style={s.pricingValue}>${m.unitPriceMin}–${m.unitPriceMax}</Text>
              </View>
              <View style={s.pricingItem}>
                <Text style={s.pricingLabel}>Sample Price</Text>
                <Text style={s.pricingValue}>${m.samplePriceMin}–${m.samplePriceMax}</Text>
              </View>
              <View style={s.pricingItem}>
                <Text style={s.pricingLabel}>Lead Time</Text>
                <Text style={s.pricingValue}>{m.leadTimeDays} days</Text>
              </View>
            </View>
          </SectionCard>

          {/* ── Gallery ── */}
          <SectionCard title="Gallery">
            <GradientCard colors={GRAD_CARD_GLOW} style={s.galleryPlaceholder}>
              <Feather name="image" size={ICON.xl} color={MUTED} style={{ alignSelf: 'center' }} />
              <Text style={s.galleryText}>Factory images coming soon</Text>
              <Text style={s.gallerySubText}>Photos and videos will be available once the manufacturer connects their profile.</Text>
            </GradientCard>
          </SectionCard>

          {/* ── Reviews ── */}
          <SectionCard title="Reviews">
            {DEMO_REVIEWS.length === 0 ? (
              <EmptyState icon="star" title="No reviews yet" description="Be the first to review this manufacturer after completing an order." />
            ) : (
              DEMO_REVIEWS.slice(0, 3).map(rev => (
                <View key={rev.id} style={s.reviewCard}>
                  <View style={s.reviewHeader}>
                    <Text style={s.reviewerName}>{rev.sellerName}</Text>
                    <Text style={s.reviewDate}>{rev.createdAt}</Text>
                  </View>
                  <StarRating rating={rev.rating} size={12} />
                  <Text style={s.reviewComment}>{rev.comment}</Text>
                </View>
              ))
            )}
          </SectionCard>

          {/* ── Shipping ── */}
          {m.shippingRegions.length > 0 && (
            <SectionCard title="Shipping Regions">
              <View style={s.chipRow}>
                {m.shippingRegions.map(r => (
                  <Chip key={r} label={r} color={'rgba(16,185,129,0.12)'} textColor={SUCCESS} />
                ))}
              </View>
            </SectionCard>
          )}

          {/* ── Contact ── */}
          <SectionCard title="Contact">
            {m.email && (
              <View style={s.contactRow}>
                <Feather name="mail" size={ICON.sm} color={PURPLE_LIGHT} />
                <Text style={s.contactText}>{m.email}</Text>
              </View>
            )}
            {m.website && (
              <View style={s.contactRow}>
                <Feather name="globe" size={ICON.sm} color={CYAN} />
                <Text style={s.contactText}>{m.website}</Text>
              </View>
            )}
            {m.phone && (
              <View style={s.contactRow}>
                <Feather name="phone" size={ICON.sm} color={SUCCESS} />
                <Text style={s.contactText}>{m.phone}</Text>
              </View>
            )}
            {!m.email && !m.website && !m.phone && (
              <Text style={s.noContact}>No contact information available.</Text>
            )}
          </SectionCard>
        </View>
      </ScrollView>

      {/* ── Sticky Quote Button ── */}
      <View style={[s.stickyBottom, { paddingBottom: insets.bottom + SP.sm }]}>
        <PrimaryButton
          label="Request Quote"
          onPress={handleQuote}
          icon="file-text"
          style={{ marginHorizontal: SP.md }}
        />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
    margin: SP.md,
  },
  backBtnHero: {
    position: 'absolute', top: 0, left: SP.md,
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  hero: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.lg,
    alignItems: 'center',
    gap: SP.sm,
  },
  factoryIconWrap: {
    marginTop: SP.xl,
  },
  factoryIconBg: {
    width: 80, height: 80, borderRadius: RADIUS.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  heroNameRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap', justifyContent: 'center',
  },
  heroName: {
    fontSize: FS.xl, fontFamily: FONT.bold, color: ON_DARK, textAlign: 'center',
  },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(34,211,238,0.15)', borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm, paddingVertical: 3,
  },
  verifiedText: {
    fontSize: FS.xs, fontFamily: FONT.semibold, color: CYAN,
  },
  heroLocationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  heroLocation: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
  },
  heroRatingRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
  },
  heroRatingText: {
    fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED,
  },
  quickActions: {
    flexDirection: 'row', backgroundColor: SURFACE,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  qaBtn: {
    flex: 1, alignItems: 'center', paddingVertical: SP.md, gap: SP.xs,
  },
  qaBtnLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED,
  },
  content: {
    padding: SP.md, gap: SP.md,
  },
  sectionCard: {
    backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: BORDER, padding: SP.md, gap: SP.sm,
  },
  sectionTitle: {
    fontSize: FS.base, fontFamily: FONT.semibold, color: FG,
    marginBottom: SP.xs,
  },
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm,
  },
  chip: {
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
    borderRadius: RADIUS.pill, borderWidth: 1,
  },
  chipText: {
    fontSize: FS.xs, fontFamily: FONT.medium,
  },
  overviewGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm,
  },
  overviewItem: {
    flex: 1, minWidth: 80, backgroundColor: SURFACE,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    padding: SP.sm, alignItems: 'center', gap: 3,
  },
  overviewLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, textAlign: 'center',
  },
  overviewValue: {
    fontSize: FS.sm, fontFamily: FONT.bold, color: FG, textAlign: 'center',
  },
  description: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20,
    marginTop: SP.sm,
  },
  capabilityBlock: {
    gap: SP.sm, paddingTop: SP.sm,
    borderTopWidth: 1, borderTopColor: BORDER,
  },
  capabilityCategory: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: FG,
  },
  capSubLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE, marginBottom: SP.xs,
  },
  certRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  certIcon: {
    width: 32, height: 32, borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  certName: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: FG,
  },
  certMeta: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED,
  },
  pricingGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm,
  },
  pricingItem: {
    flex: 1, minWidth: 120, backgroundColor: SURFACE,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    padding: SP.sm, gap: SP.xs,
  },
  pricingLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED,
  },
  pricingValue: {
    fontSize: FS.md, fontFamily: FONT.bold, color: PURPLE_LIGHT,
  },
  galleryPlaceholder: {
    alignItems: 'center', padding: SP.xl, gap: SP.sm,
  },
  galleryText: {
    fontSize: FS.base, fontFamily: FONT.semibold, color: MUTED, textAlign: 'center',
  },
  gallerySubText: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', lineHeight: 18,
  },
  reviewCard: {
    backgroundColor: SURFACE, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: BORDER, padding: SP.md, gap: SP.sm,
    marginBottom: SP.sm,
  },
  reviewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  reviewerName: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: FG,
  },
  reviewDate: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE,
  },
  reviewComment: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 18,
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingVertical: SP.xs,
  },
  contactText: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
  },
  noContact: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED,
  },
  stickyBottom: {
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
    paddingTop: SP.sm,
  },
});

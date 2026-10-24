/**
 * Manufacturer Profile Screen
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { plural } from '@/lib/plural';

import { useColors } from '@/hooks/useColors';

import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

import { goBackOr } from '@/lib/navigation/goBackOr';

import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform, Linking } from 'react-native';

import { SkeletonBlock } from '@/components/ui/Skeleton';

import { CachedImage as Image } from '@/components/CachedImage';

import { LinearGradient } from 'expo-linear-gradient';

import { Icon } from '@/components/ui/Icon';

import { useRouter, useLocalSearchParams } from 'expo-router';

import { UnavailableScreen, isMissingParam } from '@/components/ui/UnavailableScreen';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics, haptic } from '@/lib/haptics';


import { SUCCESS, RED, GOLD, FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';

import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, FilterChip, StatusBadge, SectionHeader, EmptyState, FormInput } from '@/components/BrandthreadUI';

import { getManufacturer, getFavoriteManufacturerIds, saveManufacturer, unfavoriteManufacturer, getOrCreateConversation } from '@/services/manufacturerService';

import { getManufacturerProducts, lowestTierPriceCents, type ManufacturerProduct } from '@/services/manufacturerCatalog';

import { Manufacturer } from '@/services/manufacturerTypes';

import { localTimeLabel } from '@workspace/manufacturer-flow';

import { isSellerDevPreview } from '@/lib/devPreview';

import { formatMoney, fmtRelativeDay } from '@/lib/format';

// ─── Star Rating ──────────────────────────────────────────────────────────────

function StarRating({ rating, size = 14, color = GOLD }: { rating: number; size?: number; color?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Icon
          key={i}
          name={i <= Math.round(rating) ? 'star' : 'star'}
          size={size}
          color={i <= Math.round(rating) ? color : theme.subtle}
        />
      ))}
    </View>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function Chip({ label, color, textColor }: { label: string; color?: string; textColor?: string }) {
  const { theme } = useAppTheme();
  // Default: the accent at 5.5% (what the old static ACCENT_DIM was on Monochrome).
  const fill = color ?? `${theme.accent}0E`;
  return (
    <View style={[chipStyles.chip, { backgroundColor: fill, borderColor: fill }]}>
      <Text style={[chipStyles.chipText, { color: textColor ?? theme.accentLight }]}>{label}</Text>
    </View>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ s, title, children }: { s: ProfileStyles; title: string; children: React.ReactNode }) {
  return (
    <View style={s.sectionCard}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ManufacturerProfileScreen() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [manufacturer, setManufacturer] = useState<Manufacturer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [products, setProducts] = useState<ManufacturerProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState(false);

  useEffect(() => {
    // A link without an id can never load; show "unavailable" instead of a spinner.
    if (!id) { setLoading(false); return; }
    let active = true;
    Promise.all([getManufacturer(id), getFavoriteManufacturerIds()]).then(([mfg, favoriteIds]) => {
      if (!active) return;
      setManufacturer(mfg ?? null);
      setSaved(favoriteIds.includes(id));
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setManufacturer(null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setProductsLoading(true);
    setProductsError(false);
    getManufacturerProducts(id)
      .then((rows) => { if (active) setProducts(rows); })
      .catch(() => { if (active) setProductsError(true); })
      .finally(() => { if (active) setProductsLoading(false); });
    return () => { active = false; };
  }, [id]);

  async function handleSave() {
    if (!id || actionLoading) return;
    if (!saved) haptic('save');
    setActionLoading(true);
    try {
      if (saved) {
        await unfavoriteManufacturer(id);
        setSaved(false);
      } else {
        await saveManufacturer(id);
        setSaved(true);
      }
    } catch {
      Alert.alert("Couldn't update favorite", 'Try again.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleMessage() {
    if (!id) return;
    if (isSellerDevPreview()) {
      Alert.alert('Sign in required', 'Sign in to message this manufacturer.');
      return;
    }
    try {
      const conv = await getOrCreateConversation(id, { contextLabel: 'General' });
      router.push(('/manufacturer-messages?threadId=' + conv.id) as never);
    } catch {
      Alert.alert("Couldn't open conversation", 'Try again.');
    }
  }

  function handleQuote() {
    router.push(('/quote-request?manufacturerId=' + id) as never);
  }

  // Opened without an id (deep link / typed route): nothing can load, so
  // show the shared not-found screen instead of an endless spinner.
  if (isMissingParam(id)) {
    return (
      <UnavailableScreen
        title="Manufacturer"
        heading="Manufacturer not found"
        message="This profile isn't available."
        icon="briefcase"
      />
    );
  }

  if (loading) {
    return <ProfileSkeleton s={s} topInset={headerTopInset} />;
  }

  if (!manufacturer) {
    return (
      <View style={[s.root, { paddingTop: headerTopInset }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBackOr(router)} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="arrow-left" size={ICON.md} color={theme.text} />
        </TouchableOpacity>
        <EmptyState icon="alert-circle" title="Manufacturer unavailable" description="This profile is no longer listed, or it's a private manufacturer you aren't connected to." action={{ label: 'Back to directory', onPress: () => goBackOr(router) }} />
      </View>
    );
  }

  const m = manufacturer;

  return (
    <View style={[s.root, { paddingTop: 0 }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {/* ── Hero ── */}
        <LinearGradient
          colors={theme.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[s.hero, { paddingTop: headerTopInset + SP.sm }]}
        >
          {/* Back button */}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => goBackOr(router)} style={s.backBtnHero} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="arrow-left" size={ICON.md} color={theme.text} />
          </TouchableOpacity>

          {/* Factory icon */}
          <View style={s.factoryIconWrap}>
            {m.profileImageUri ? (
              <Image cachePolicy="memory-disk" source={{ uri: m.profileImageUri }} style={s.factoryIconBg} contentFit="cover" accessibilityLabel={`${m.name} lead photo`} />
            ) : (
              <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.factoryIconBg}>
                <Icon name="settings" size={ICON.xxl} color={theme.onAccent} />
              </LinearGradient>
            )}
          </View>

          {/* Name + verified */}
          <View style={s.heroNameRow}>
             <Text style={[s.heroName, { color: theme.text }]}>{m.name}</Text>
            {m.isVerified && (
              <View style={[s.verifiedBadge, { backgroundColor: theme.secondaryDim }]}>
                <Icon name="check-circle" size={14} color={theme.secondary} />
                <Text style={[s.verifiedText, { color: theme.secondary }]}>Verified</Text>
              </View>
            )}
          </View>

          {/* Location */}
          <View style={s.heroLocationRow}>
             <Icon name="map-pin" size={12} color={theme.onAccent} />
             <Text style={[s.heroLocation, getOnAccentTextStyle(theme)]}>{[m.city, m.country].filter(Boolean).join(', ')}</Text>
          </View>
          {(localTimeLabel(m.timeZone) || m.isPublicDirectory === false) && (
            <View style={s.heroLocationRow}>
              {localTimeLabel(m.timeZone) ? (
                <>
                  <Icon name="clock" size={12} color={theme.onAccent} />
                  <Text style={[s.heroLocation, getOnAccentTextStyle(theme)]} testID="profile-local-time">{localTimeLabel(m.timeZone)}</Text>
                </>
              ) : null}
              {m.isPublicDirectory === false && (
                <View style={[s.verifiedBadge, s.privateBadge]}>
                  <Icon name="lock" size={12} color={theme.onAccent} />
                  <Text style={[s.verifiedText, { color: theme.onAccent }]}>Private partner</Text>
                </View>
              )}
            </View>
          )}

          {/* Rating */}
          <View style={s.heroRatingRow}>
             <StarRating rating={m.rating} color={theme.onAccent} />
             <Text style={[s.heroRatingText, getOnAccentTextStyle(theme)]}>
               {m.reviewCount > 0 ? `${m.rating.toFixed(1)} (${plural(m.reviewCount, 'review')})` : 'No ratings yet'}
             </Text>
          </View>
        </LinearGradient>

        {/* ── Quick Actions ── */}
        <View style={s.quickActions}>
          <TouchableOpacity onPress={handleSave} style={s.qaBtn} activeOpacity={0.8}>
            <Icon name="heart" size={ICON.md} color={saved ? RED : theme.muted} />
            <Text style={[s.qaBtnLabel, saved && { color: RED }]}>{saved ? 'Saved' : 'Save'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleMessage} style={s.qaBtn} activeOpacity={0.8}>
            <Icon name="message-circle" size={ICON.md} color={CYAN} />
            <Text style={[s.qaBtnLabel, { color: CYAN }]}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/manufacturer-hub?tab=messages' as never)} style={s.qaBtn} activeOpacity={0.8}>
            <Icon name="inbox" size={ICON.md} color={PURPLE_LIGHT} />
            <Text style={[s.qaBtnLabel, { color: PURPLE_LIGHT }]}>Messages</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleQuote} style={s.qaBtn} activeOpacity={0.8}>
            <Icon name="file-text" size={ICON.md} color={PURPLE_LIGHT} />
            <Text style={[s.qaBtnLabel, { color: PURPLE_LIGHT }]}>Quote</Text>
          </TouchableOpacity>
        </View>

        <View style={s.content}>
          {/* ── Overview ── */}
          <SectionCard s={s} title="Overview">
            <View style={s.overviewGrid}>
              {([
                { icon: 'clock', label: 'Years in business', value: m.yearsInBusiness > 0 ? `${m.yearsInBusiness} ${m.yearsInBusiness === 1 ? 'year' : 'years'}` : 'New' },
                { icon: 'package', label: 'Minimum order', value: m.moq > 0 ? `${m.moq.toLocaleString('en-US')} pcs` : null },
                { icon: 'tag', label: 'Price per piece', value: m.priceRangeLabel ?? null },
                { icon: 'scissors', label: 'Sample time', value: m.sampleTurnaround ?? null },
                { icon: 'calendar', label: 'Bulk time', value: m.bulkTurnaround ?? (m.leadTimeDays ? plural(m.leadTimeDays, 'day') : null) },
                { icon: 'zap', label: 'Replies in', value: m.responseTimeHours > 0 ? `~${m.responseTimeHours}h` : null },
              ] as const).filter((item) => item.value).map((item) => (
                <View key={item.label} style={s.overviewItem}>
                  <Icon name={item.icon} size={ICON.sm} color={theme.text} />
                  <Text style={s.overviewLabel}>{item.label}</Text>
                  <Text style={s.overviewValue}>{item.value}</Text>
                </View>
              ))}
            </View>
            {!!m.description && <Text style={s.description}>{m.description}</Text>}
          </SectionCard>

          {/* ── Categories ── */}
          {m.categories.length > 0 && (
            <SectionCard s={s} title="Categories">
              <View style={s.chipRow}>
                {m.categories.map(c => <Chip key={c} label={c} />)}
              </View>
            </SectionCard>
          )}

          {/* ── Specialties ── */}
          {m.specialties.length > 0 && (
            <SectionCard s={s} title="Specialties">
              <View style={s.chipRow}>
                {m.specialties.map(s2 => <Chip key={s2} label={s2} color={theme.secondaryDim} textColor={theme.secondary} />)}
              </View>
            </SectionCard>
          )}

          {/* ── Capabilities ── */}
          {m.capabilities.length > 0 && (
            <SectionCard s={s} title="Capabilities">
              {m.capabilities.map(cap => (
                <View key={cap.id} style={s.capabilityBlock}>
                  <Text style={s.capabilityCategory}>{cap.category}</Text>
                  {cap.materials.length > 0 && (
                    <View>
                      <Text style={s.capSubLabel}>Materials</Text>
                      <View style={s.chipRow}>
                        {cap.materials.map(mat => <Chip key={mat} label={mat} color={theme.surface} textColor={theme.muted} />)}
                      </View>
                    </View>
                  )}
                  {cap.printMethods && cap.printMethods.length > 0 && (
                    <View style={{ marginTop: SP.sm }}>
                      <Text style={s.capSubLabel}>Print methods</Text>
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
            <SectionCard s={s} title="Certifications">
              {m.certifications.map(cert => (
                <View key={cert.id} style={s.certRow}>
                  <View style={s.certIcon}>
                    <Icon name="award" size={ICON.sm} color={GOLD} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.certName}>{cert.name}</Text>
                    {cert.issuer && <Text style={s.certMeta}>Issued by {cert.issuer}</Text>}
                    {cert.validUntil && <Text style={s.certMeta}>Valid until {cert.validUntil}</Text>}
                  </View>
                  {cert.validUntil && new Date(cert.validUntil).getTime() < Date.now()
                    ? <StatusBadge label="Expired" variant="neutral" small />
                    : <StatusBadge label="Active" variant="success" small />}
                </View>
              ))}
            </SectionCard>
          )}

          {/* ── Materials ── */}
          {m.materials.length > 0 && (
            <SectionCard s={s} title="Materials">
              <View style={s.chipRow}>
                {m.materials.map(mat => <Chip key={mat} label={mat} color={theme.surface} textColor={theme.text} />)}
              </View>
            </SectionCard>
          )}

          {/* ── Pricing ── */}
          <SectionCard s={s} title="Pricing">
            <View style={s.pricingGrid}>
              <View style={s.pricingItem}>
                <Text style={s.pricingLabel}>Minimum order</Text>
                <Text style={s.pricingValue}>{m.moq > 0 ? `${m.moq.toLocaleString('en-US')} units` : 'On request'}</Text>
              </View>
              <View style={s.pricingItem}>
                <Text style={s.pricingLabel}>Unit Price</Text>
                <Text style={s.pricingValue}>{formatMoney(m.unitPriceMinCents)}–{formatMoney(m.unitPriceMaxCents)}</Text>
              </View>
              <View style={s.pricingItem}>
                <Text style={s.pricingLabel}>Sample Price</Text>
                <Text style={s.pricingValue}>{formatMoney(m.samplePriceMinCents)}–{formatMoney(m.samplePriceMaxCents)}</Text>
              </View>
              <View style={s.pricingItem}>
                <Text style={s.pricingLabel}>Lead Time</Text>
                <Text style={s.pricingValue}>{plural(m.leadTimeDays, 'day')}</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => { router.push((`/request-sample?manufacturerId=${m.id}`) as never); }}
              style={s.requestSampleBtn}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Request a sample from ${m.name}`}
            >
              <Icon name="scissors" size={ICON.sm} color={theme.text} />
              <Text style={s.requestSampleBtnText}>Request a Sample</Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ── Product / Sample Catalog ── */}
          <SectionCard s={s} title="Product catalog">
            {productsLoading ? (
              <ActivityIndicator color={PURPLE} />
            ) : productsError ? (
              <EmptyState icon="wifi-off" title="Catalog unavailable" description="Could not load this manufacturer's product catalog." />
            ) : products.length === 0 ? (
              <EmptyState icon="grid" title="No catalog products yet" description="This manufacturer hasn't listed browsable products with quantity pricing." />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catalogRow}>
                {products.map((product) => {
                  const from = lowestTierPriceCents(product);
                  return (
                    <TouchableOpacity
                      key={product.id}
                      style={s.catalogCard}
                      activeOpacity={0.85}
                      onPress={() => router.push((`/manufacturer-product?manufacturerId=${m.id}&productId=${product.id}`) as never)}
                      testID={`catalog-product-${product.id}`}
                    >
                      {product.images[0] ? (
                        <Image cachePolicy="memory-disk" source={{ uri: product.images[0] }} style={s.catalogImage} contentFit="cover" />
                      ) : (
                        <View style={[s.catalogImage, s.catalogImageFallback]}>
                          <Icon name="package" size={ICON.lg} color={theme.subtle} />
                        </View>
                      )}
                      <Text style={s.catalogName} numberOfLines={2}>{product.name}</Text>
                      {from !== undefined && (
                        <Text style={s.catalogPrice}>from {formatMoney(from)}/unit</Text>
                      )}
                      <Text style={s.catalogMeta}>Min. {product.moq.toLocaleString('en-US')} · {product.leadTimeDays}-day lead</Text>
                      {product.priceTiers.length > 0 && (
                        <View style={s.tierMiniTable}>
                          {product.priceTiers.slice(0, 3).map((tier) => (
                            <View key={tier.id} style={s.tierMiniRow}>
                              <Text style={s.tierMiniQty}>
                                {tier.minQuantity}{tier.maxQuantity ? `–${tier.maxQuantity}` : '+'}
                              </Text>
                              <Text style={s.tierMiniPrice}>{formatMoney(tier.unitPriceCents)}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </SectionCard>

          {/* ── Gallery ── */}
          <SectionCard s={s} title="Gallery">
            {m.galleryUris.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.galleryRow}>
                {m.galleryUris.map((uri, index) => (
                  <Image cachePolicy="memory-disk" key={`${uri}-${index}`} source={{ uri }} style={s.galleryImage} />
                ))}
              </ScrollView>
            ) : (
              <EmptyState icon="image" title="No factory photos yet" description="This manufacturer has not added production photos to their profile." />
            )}
          </SectionCard>

          {/* ── Reviews ── */}
          <SectionCard s={s} title="Reviews">
            {m.reviews.length === 0 ? (
              <EmptyState icon="star" title="No reviews yet" description="Ratings will appear here after completed orders are reviewed." />
            ) : m.reviews.map((review) => (
              <View key={review.id} style={s.reviewCard}>
                <View style={s.reviewHeader}>
                  <View style={{ gap: SP.xs }}>
                    <Text style={s.reviewerName}>{review.sellerName}</Text>
                    <StarRating rating={review.rating} />
                  </View>
                  <Text style={s.reviewDate}>{fmtRelativeDay(review.createdAt)}</Text>
                </View>
                {!!review.comment && <Text style={s.reviewComment}>{review.comment}</Text>}
                <Text style={s.reviewBreakdown}>
                  Quality {review.qualityRating}/5 · Communication {review.communicationRating}/5 · Delivery {review.deliveryRating}/5
                </Text>
              </View>
            ))}
          </SectionCard>

          {/* ── Shipping ── */}
          {m.shippingRegions.length > 0 && (
            <SectionCard s={s} title="Shipping regions">
              <View style={s.chipRow}>
                {m.shippingRegions.map(r => (
                  <Chip key={r} label={r} color={theme.surface} textColor={theme.text} />
                ))}
              </View>
            </SectionCard>
          )}

          {/* ── Contact ── */}
          <SectionCard s={s} title="Contact">
            {m.email && (
              <TouchableOpacity style={s.contactRow} onPress={() => void Linking.openURL(`mailto:${m.email}`)} accessibilityRole="link" accessibilityLabel={`Email ${m.email}`}>
                <Icon name="mail" size={ICON.sm} color={PURPLE_LIGHT} />
                <Text style={s.contactText}>{m.email}</Text>
              </TouchableOpacity>
            )}
            {m.website && (
              <TouchableOpacity style={s.contactRow} onPress={() => void Linking.openURL(/^https?:\/\//i.test(m.website!) ? m.website! : `https://${m.website}`)} accessibilityRole="link" accessibilityLabel={`Open ${m.website}`}>
                <Icon name="globe" size={ICON.sm} color={CYAN} />
                <Text style={s.contactText}>{m.website}</Text>
              </TouchableOpacity>
            )}
            {m.phone && (
              <TouchableOpacity style={s.contactRow} onPress={() => void Linking.openURL(`tel:${m.phone!.replace(/[^\d+]/g, '')}`)} accessibilityRole="link" accessibilityLabel={`Call ${m.phone}`}>
                <Icon name="phone" size={ICON.sm} color={SUCCESS} />
                <Text style={s.contactText}>{m.phone}</Text>
              </TouchableOpacity>
            )}
            {!m.email && !m.website && !m.phone && (
              <Text style={s.noContact}>{m.contactHidden ? 'Contact details are shared after your first paid order.' : 'No contact information available.'}</Text>
            )}
          </SectionCard>
        </View>
      </ScrollView>

      {/* ── Sticky Quote Button ── */}
      <View style={[s.stickyBottom, { paddingBottom: insets.bottom + SP.sm }]}>
        <PrimaryButton
          label="Request a quote"
          onPress={handleQuote}
          icon="file-text"
          style={{ marginHorizontal: SP.md }}
        />
      </View>
    </View>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

/** Hero, quick-action row and two section cards: the shape the profile lands in. */
function ProfileSkeleton({ s, topInset }: { s: ProfileStyles; topInset: number }) {
  return (
    <View style={s.root} accessibilityLabel="Loading manufacturer" accessibilityRole="progressbar">
      <View style={[s.hero, { paddingTop: topInset + SP.sm }]}>
        <View style={s.factoryIconWrap}>
          <SkeletonBlock width={80} height={80} radius={RADIUS.xl} />
        </View>
        <SkeletonBlock width={180} height={22} radius={6} />
        <SkeletonBlock width={120} height={14} radius={4} />
        <SkeletonBlock width={140} height={14} radius={4} />
      </View>
      <View style={s.quickActions}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={s.qaBtn}>
            <SkeletonBlock width={22} height={22} radius={11} />
            <SkeletonBlock width={44} height={10} radius={4} />
          </View>
        ))}
      </View>
      <View style={s.content}>
        {[0, 1].map((card) => (
          <View key={card} style={s.sectionCard}>
            <SkeletonBlock width={110} height={16} radius={4} />
            <View style={s.overviewGrid}>
              {[0, 1, 2].map((i) => <SkeletonBlock key={i} width={96} height={64} radius={RADIUS.md} style={{ flex: 1, minWidth: 80 }} />)}
            </View>
            <SkeletonBlock width="90%" height={12} radius={4} />
            <SkeletonBlock width="70%" height={12} radius={4} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

type ProfileStyles = ReturnType<typeof makeStyles>;

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center',
    margin: SP.md,
  },
  backBtnHero: {
    position: 'absolute', top: 0, left: SP.md,
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.4)', // theme-exempt: scrim over the hero gradient
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
    fontSize: FS.xl, fontFamily: FONT.bold, color: theme.text, textAlign: 'center',
  },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm, paddingVertical: 3,
  },
  privateBadge: {
    backgroundColor: 'rgba(0,0,0,0.35)', // theme-exempt: scrim over the hero gradient
  },
  verifiedText: {
    fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.secondary,
  },
  heroLocationRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  heroLocation: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted,
  },
  heroRatingRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
  },
  heroRatingText: {
    fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted,
  },
  quickActions: {
    flexDirection: 'row', backgroundColor: theme.surface,
    borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  qaBtn: {
    flex: 1, alignItems: 'center', paddingVertical: SP.md, gap: SP.xs,
  },
  qaBtnLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted,
  },
  content: {
    padding: SP.md, gap: SP.md,
  },
  sectionCard: {
    backgroundColor: theme.surface, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: theme.border, padding: SP.md, gap: SP.sm,
  },
  sectionTitle: {
    fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text,
    marginBottom: SP.xs,
  },
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm,
  },
  overviewGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm,
  },
  overviewItem: {
    flex: 1, minWidth: 80, backgroundColor: theme.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    padding: SP.sm, alignItems: 'center', gap: 3,
  },
  overviewLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted, textAlign: 'center',
  },
  overviewValue: {
    fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text, textAlign: 'center',
  },
  description: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 20,
    marginTop: SP.sm,
  },
  capabilityBlock: {
    gap: SP.sm, paddingTop: SP.sm,
    borderTopWidth: 1, borderTopColor: theme.border,
  },
  capabilityCategory: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text,
  },
  capSubLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: theme.subtle, marginBottom: SP.xs,
  },
  certRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  certIcon: {
    width: 32, height: 32, borderRadius: RADIUS.sm,
    backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center',
  },
  certName: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text,
  },
  certMeta: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted,
  },
  pricingGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm,
  },
  pricingItem: {
    flex: 1, minWidth: 120, backgroundColor: theme.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border,
    padding: SP.sm, gap: SP.xs,
  },
  pricingLabel: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted,
  },
  pricingValue: {
    fontSize: FS.md, fontFamily: FONT.bold, color: theme.text,
  },
  requestSampleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs,
    marginTop: SP.sm, minHeight: COMP.minTouchTarget,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.text,
    backgroundColor: theme.surface,
  },
  requestSampleBtnText: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text,
  },
  galleryRow: {
    gap: SP.sm,
    paddingRight: SP.sm,
  },
  galleryImage: {
    width: 220,
    height: 150,
    borderRadius: RADIUS.md,
    backgroundColor: theme.surface,
  },
  reviewCard: {
    backgroundColor: theme.surface, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: theme.border, padding: SP.md, gap: SP.sm,
    marginBottom: SP.sm,
  },
  reviewHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  reviewerName: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text,
  },
  reviewDate: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle,
  },
  reviewComment: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 18,
  },
  reviewBreakdown: {
    fontSize: FS.xs, fontFamily: FONT.medium, color: theme.subtle, lineHeight: 17,
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingVertical: SP.xs, minHeight: COMP.minTouchTarget,
  },
  contactText: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text,
  },
  noContact: {
    fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted,
  },
  stickyBottom: {
    backgroundColor: theme.background, borderTopWidth: 1, borderTopColor: theme.border,
    paddingTop: SP.sm,
  },
  catalogRow: {
    gap: SP.sm, paddingRight: SP.sm,
  },
  catalogCard: {
    width: 156, backgroundColor: theme.surface, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: theme.border, padding: SP.sm, gap: 4,
  },
  catalogImage: {
    width: '100%', height: 96, borderRadius: RADIUS.sm, backgroundColor: theme.surface,
  },
  catalogImageFallback: {
    alignItems: 'center', justifyContent: 'center',
  },
  catalogName: {
    fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginTop: 4, minHeight: 32,
  },
  catalogPrice: {
    fontVariant: ['tabular-nums'],
    fontSize: FS.sm, fontFamily: FONT.bold, color: theme.accentLight,
  },
  catalogMeta: {
    fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted,
  },
  tierMiniTable: {
    marginTop: 4, gap: 2, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 4,
  },
  tierMiniRow: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  tierMiniQty: {
    fontSize: 11, fontFamily: FONT.regular, color: theme.subtle,
  },
  tierMiniPrice: {
    fontSize: 11, fontFamily: FONT.semibold, color: theme.text,
  },
});

// Layout only: a chip's colours come from its props.
const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
    borderRadius: RADIUS.pill, borderWidth: 1,
  },
  chipText: {
    fontSize: FS.xs, fontFamily: FONT.medium,
  },
});

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Dimensions, Animated, ActivityIndicator, Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { WebView } from 'react-native-webview';
import { useApi } from '@/lib/api';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader,
  EmptyState, StatCard,
} from '@/components/BrandthreadUI';
import { getStorefront } from '@/services/storeService';
import { Storefront, StoreSection, StoreSectionType, SECTION_TYPE_LABELS } from '@/services/storeTypes';

type PageType = 'homepage' | 'product' | 'collection' | 'menu' | 'cart' | 'empty_cart';
type DeviceWidth = 'narrow' | 'standard' | 'wide';

const DEVICE_WIDTHS: Record<DeviceWidth, number> = {
  narrow: 320,
  standard: 375,
  wide: 430,
};

const PAGE_LABELS: { value: PageType; label: string }[] = [
  { value: 'homepage', label: 'Homepage' },
  { value: 'product', label: 'Product' },
  { value: 'collection', label: 'Collection' },
  { value: 'menu', label: 'Menu' },
  { value: 'cart', label: 'Cart' },
  { value: 'empty_cart', label: 'Empty Cart' },
];

export default function StorePreview() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const [store, setStore] = useState<Storefront | null>(null);
  const [currentPage, setCurrentPage] = useState<PageType>('homepage');
  const [deviceWidth, setDeviceWidth] = useState<DeviceWidth>('standard');
  const [darkMode, setDarkMode] = useState(true);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Live HTML preview via WebView
  const [webViewMode, setWebViewMode] = useState(false);
  const [webViewHtml, setWebViewHtml] = useState<string | null>(null);
  const [loadingWebView, setLoadingWebView] = useState(false);

  // Share preview link
  const [sharingPreview, setSharingPreview] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getStorefront().then(setStore);
    }, [])
  );

  const handleSharePreview = async () => {
    if (sharingPreview) return;
    setSharingPreview(true);
    try {
      const result = await (api as any).store.sharePreview() as { url: string; expiresAt: string };
      await Clipboard.setStringAsync(result.url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 3000);
    } catch {
      Alert.alert('Could not generate link', 'Check your connection and try again.');
    } finally {
      setSharingPreview(false);
    }
  };

  const handleToggleWebView = async () => {
    if (webViewMode) {
      setWebViewMode(false);
      return;
    }
    setLoadingWebView(true);
    try {
      const html = await (api as any).store.previewHtml() as string;
      setWebViewHtml(html);
      setWebViewMode(true);
    } catch {
      // Fall back to native preview
    } finally {
      setLoadingWebView(false);
    }
  };

  const phoneW = DEVICE_WIDTHS[deviceWidth];
  const phoneH = phoneW * 2.1;
  const themeColors = store?.branding?.colors;
  const phoneBg = themeColors?.background ?? '#0f0f1a';
  const primaryColor = themeColors?.primary ?? PURPLE;
  const textColor = themeColors?.text ?? FG;
  const accentColor = themeColors?.accent ?? CYAN;

  const enabledSections = (store?.sections ?? [])
    .filter(s => s.enabled)
    .sort((a, b) => a.order - b.order);

  function renderSectionBlock(section: StoreSection) {
    const isSelected = selectedSectionId === section.id;
    const borderClr = isSelected ? accentColor : 'transparent';

    const handleTap = () => {
      setSelectedSectionId(section.id);
      router.push(('/store-editor?sectionId=' + section.id) as never);
    };

    const baseBlock = (content: React.ReactNode, height = 80) => (
      <TouchableOpacity
        key={section.id}
        onPress={handleTap}
        activeOpacity={0.85}
        style={[previewStyles.sectionBlock, { height, borderColor: borderClr, borderWidth: isSelected ? 2 : 0 }]}
      >
        {content}
      </TouchableOpacity>
    );

    switch (section.type) {
      case 'hero_image':
      case 'hero_video':
      case 'hero_slideshow':
        return baseBlock(
          <LinearGradient
            colors={[primaryColor, accentColor]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          >
            <View style={previewStyles.heroContent}>
              <Text style={[previewStyles.heroHeading, { color: '#fff' }]} numberOfLines={1}>
                {section.settings.heading || 'The Brand.'}
              </Text>
              <View style={[previewStyles.heroBtn, { backgroundColor: '#fff' }]}>
                <Text style={[previewStyles.heroBtnText, { color: primaryColor }]}>
                  {section.settings.buttonLabel || 'Shop Now'}
                </Text>
              </View>
            </View>
          </LinearGradient>,
          150
        );

      case 'featured_collection':
      case 'product_grid':
        return baseBlock(
          <View style={{ flex: 1, backgroundColor: phoneBg, padding: 6 }}>
            <Text style={[previewStyles.blockLabel, { color: textColor }]}>
              {section.settings.heading || section.label}
            </Text>
            <View style={previewStyles.miniGrid}>
              {[0, 1, 2, 3].map(i => (
                <View key={i} style={[previewStyles.miniCard, { backgroundColor: primaryColor + '22' }]} />
              ))}
            </View>
          </View>,
          110
        );

      case 'brand_story':
        return baseBlock(
          <View style={{ flex: 1, backgroundColor: phoneBg, padding: 8, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[previewStyles.blockLabel, { color: textColor, textAlign: 'center', marginBottom: 6 }]}>
              {section.settings.heading || 'Our Story'}
            </Text>
            {[70, 85, 60, 75].map((w, i) => (
              <View key={i} style={[previewStyles.textLine, { width: `${w}%`, backgroundColor: textColor + '22' }]} />
            ))}
          </View>,
          100
        );

      case 'announcement':
        return baseBlock(
          <View style={[{ flex: 1, backgroundColor: primaryColor, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ fontSize: 9, fontFamily: FONT.medium, color: '#fff' }} numberOfLines={1}>
              {section.settings.heading || 'Free shipping on orders over $150'}
            </Text>
          </View>,
          28
        );

      case 'newsletter':
        return baseBlock(
          <View style={{ flex: 1, backgroundColor: primaryColor + '18', padding: 8, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[previewStyles.blockLabel, { color: textColor }]}>
              {section.settings.heading || 'Join the community.'}
            </Text>
            <View style={[previewStyles.emailMock, { borderColor: textColor + '44', backgroundColor: phoneBg }]}>
              <Text style={{ fontSize: 8, color: textColor + '88' }}>Enter your email</Text>
            </View>
          </View>,
          90
        );

      case 'drop_countdown':
        return baseBlock(
          <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[previewStyles.blockLabel, { color: '#fff', marginBottom: 4 }]}>
              {section.settings.heading || 'New Drop Coming'}
            </Text>
            <View style={previewStyles.timerRow}>
              {['00', '12', '34', '56'].map((v, i) => (
                <View key={i} style={[previewStyles.timerBlock, { backgroundColor: primaryColor }]}>
                  <Text style={previewStyles.timerVal}>{v}</Text>
                </View>
              ))}
            </View>
          </View>,
          90
        );

      case 'seller_posts':
        return baseBlock(
          <View style={{ flex: 1, backgroundColor: phoneBg, padding: 6 }}>
            <Text style={[previewStyles.blockLabel, { color: textColor, marginBottom: 4 }]}>
              {section.settings.heading || 'From the Thread'}
            </Text>
            <View style={previewStyles.postsRow}>
              {[0, 1, 2].map(i => (
                <View key={i} style={[previewStyles.postSquare, { backgroundColor: primaryColor + '33' }]} />
              ))}
            </View>
          </View>,
          90
        );

      case 'customer_reviews':
        return baseBlock(
          <View style={{ flex: 1, backgroundColor: phoneBg, padding: 6 }}>
            <Text style={[previewStyles.blockLabel, { color: textColor, marginBottom: 4 }]}>
              {section.settings.heading || 'Reviews'}
            </Text>
            <View style={previewStyles.reviewRow}>
              {[0, 1].map(i => (
                <View key={i} style={[previewStyles.reviewCard, { backgroundColor: primaryColor + '18', borderColor: primaryColor + '33' }]}>
                  <View style={previewStyles.starsRow}>
                    {[0,1,2,3,4].map(s => <Text key={s} style={{ fontSize: 7, color: GOLD }}>★</Text>)}
                  </View>
                  {[0,1].map(j => <View key={j} style={[previewStyles.textLine, { width: '80%', backgroundColor: textColor + '22', marginTop: 3 }]} />)}
                </View>
              ))}
            </View>
          </View>,
          90
        );

      case 'image_with_text':
        return baseBlock(
          <View style={{ flex: 1, flexDirection: 'row', backgroundColor: phoneBg }}>
            <View style={{ flex: 1, backgroundColor: primaryColor + '33' }} />
            <View style={{ flex: 1, padding: 8, justifyContent: 'center' }}>
              <Text style={[previewStyles.blockLabel, { color: textColor, marginBottom: 4 }]}>
                {section.settings.heading || 'Designed to last.'}
              </Text>
              {[0,1].map(i => <View key={i} style={[previewStyles.textLine, { backgroundColor: textColor + '22', marginTop: 3 }]} />)}
            </View>
          </View>,
          100
        );

      case 'spacer':
        return baseBlock(
          <View style={{ flex: 1, backgroundColor: phoneBg + '44' }} />,
          24
        );

      default:
        return baseBlock(
          <View style={{ flex: 1, backgroundColor: primaryColor + '11', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontSize: 9, fontFamily: FONT.medium, color: textColor + 'aa' }}>
              {SECTION_TYPE_LABELS[section.type] || section.label}
            </Text>
          </View>,
          60
        );
    }
  }

  function renderHomepage() {
    if (enabledSections.length === 0) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
          <Text style={{ fontSize: 10, color: textColor + '88', textAlign: 'center' }}>
            No sections enabled.{'\n'}Add sections in the editor.
          </Text>
        </View>
      );
    }
    return <>{enabledSections.map(s => renderSectionBlock(s))}</>;
  }

  function renderProductPage() {
    return (
      <>
        <View style={[previewStyles.productImage, { backgroundColor: primaryColor + '33' }]} />
        <View style={{ padding: 10, backgroundColor: phoneBg }}>
          <Text style={[previewStyles.blockLabel, { color: textColor, fontSize: 11 }]}>Product Name</Text>
          <Text style={{ fontSize: 10, color: accentColor, fontFamily: FONT.semibold, marginTop: 2 }}>$89.00</Text>
          <View style={previewStyles.variantRow}>
            {['S', 'M', 'L', 'XL'].map(v => (
              <View key={v} style={[previewStyles.variantBtn, { borderColor: textColor + '44', backgroundColor: v === 'M' ? primaryColor : 'transparent' }]}>
                <Text style={{ fontSize: 8, color: v === 'M' ? '#fff' : textColor, fontFamily: FONT.medium }}>{v}</Text>
              </View>
            ))}
          </View>
          <View style={[previewStyles.addToCartBtn, { backgroundColor: primaryColor }]}>
            <Text style={{ fontSize: 9, color: '#fff', fontFamily: FONT.bold }}>Add to Cart</Text>
          </View>
          {[70, 85, 60].map((w, i) => (
            <View key={i} style={[previewStyles.textLine, { width: `${w}%`, backgroundColor: textColor + '22', marginTop: 4 }]} />
          ))}
        </View>
      </>
    );
  }

  function renderCollectionPage() {
    return (
      <View style={{ backgroundColor: phoneBg, flex: 1 }}>
        <View style={[previewStyles.collectionHeader, { backgroundColor: primaryColor + '22' }]}>
          <Text style={[previewStyles.blockLabel, { color: textColor }]}>Collection</Text>
        </View>
        <View style={previewStyles.collectionGrid}>
          {[0,1,2,3].map(i => (
            <View key={i} style={[previewStyles.collectionCard, { backgroundColor: primaryColor + '22' }]}>
              <View style={[previewStyles.collectionCardImg, { backgroundColor: primaryColor + '44' }]} />
              <Text style={{ fontSize: 8, color: textColor, fontFamily: FONT.medium, marginTop: 4 }}>Product {i + 1}</Text>
              <Text style={{ fontSize: 7, color: accentColor, fontFamily: FONT.semibold }}>$49.00</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  function renderMenuPage() {
    const menuItems = store?.menus?.[0]?.items;
    const items = menuItems && menuItems.length > 0
      ? menuItems.map(item => item.label)
      : ['Shop', 'Collections', 'Brand Story', 'About', 'Contact'];

    return (
      <View style={{ backgroundColor: phoneBg, flex: 1, padding: 10 }}>
        <View style={previewStyles.hamburgerHeader}>
          <View style={previewStyles.hamburgerLogo} />
          <Feather name="x" size={12} color={textColor} />
        </View>
        {items.slice(0, 6).map((label, i) => (
          <View key={i} style={[previewStyles.menuItem, { borderBottomColor: textColor + '22' }]}>
            <Text style={{ fontSize: 11, color: textColor, fontFamily: FONT.semibold }}>{label}</Text>
            <Feather name="chevron-right" size={10} color={textColor + '66'} />
          </View>
        ))}
      </View>
    );
  }

  function renderCartPage() {
    return (
      <View style={{ backgroundColor: phoneBg, flex: 1, padding: 10 }}>
        <Text style={[previewStyles.blockLabel, { color: textColor, marginBottom: 8 }]}>Your Cart</Text>
        {[0, 1].map(i => (
          <View key={i} style={[previewStyles.cartRow, { borderBottomColor: textColor + '22' }]}>
            <View style={[previewStyles.cartItemImg, { backgroundColor: primaryColor + '44' }]} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 9, color: textColor, fontFamily: FONT.medium }}>Product Name</Text>
              <Text style={{ fontSize: 8, color: accentColor, fontFamily: FONT.semibold }}>$89.00</Text>
            </View>
            <View style={previewStyles.qtyBox}>
              <Text style={{ fontSize: 8, color: textColor }}>1</Text>
            </View>
          </View>
        ))}
        <View style={[previewStyles.cartTotal, { borderTopColor: textColor + '22' }]}>
          <Text style={{ fontSize: 9, color: textColor, fontFamily: FONT.medium }}>Total</Text>
          <Text style={{ fontSize: 10, color: textColor, fontFamily: FONT.bold }}>$178.00</Text>
        </View>
        <View style={[previewStyles.addToCartBtn, { backgroundColor: primaryColor, marginTop: 8 }]}>
          <Text style={{ fontSize: 9, color: '#fff', fontFamily: FONT.bold }}>Checkout</Text>
        </View>
      </View>
    );
  }

  function renderEmptyCart() {
    return (
      <View style={{ backgroundColor: phoneBg, flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <Feather name="shopping-bag" size={28} color={textColor + '44'} />
        <Text style={{ fontSize: 11, color: textColor, fontFamily: FONT.bold, marginTop: 8 }}>Your cart is empty</Text>
        <Text style={{ fontSize: 9, color: textColor + '88', fontFamily: FONT.regular, marginTop: 4, textAlign: 'center' }}>
          Looks like you haven't added anything yet.
        </Text>
        <View style={[previewStyles.addToCartBtn, { backgroundColor: primaryColor, marginTop: 12, paddingHorizontal: 16 }]}>
          <Text style={{ fontSize: 9, color: '#fff', fontFamily: FONT.bold }}>Continue Shopping</Text>
        </View>
      </View>
    );
  }

  function renderPageContent() {
    switch (currentPage) {
      case 'homepage': return renderHomepage();
      case 'product': return renderProductPage();
      case 'collection': return renderCollectionPage();
      case 'menu': return renderMenuPage();
      case 'cart': return renderCartPage();
      case 'empty_cart': return renderEmptyCart();
    }
  }

  const selectedSection = selectedSectionId
    ? store?.sections.find(s => s.id === selectedSectionId)
    : null;

  const screenWidth = Dimensions.get('window').width;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      {!fullscreen && (
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Store Preview</Text>
          <TouchableOpacity
            onPress={handleSharePreview}
            style={[styles.shareBtn, shareCopied && styles.shareBtnCopied]}
            disabled={sharingPreview}
          >
            {sharingPreview
              ? <ActivityIndicator size="small" color={PURPLE_LIGHT} />
              : <Feather name={shareCopied ? 'check' : 'link'} size={ICON.sm} color={shareCopied ? '#4ade80' : PURPLE_LIGHT} />
            }
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/store-editor' as never)}
            style={styles.editBtn}
          >
            <Text style={styles.editBtnText}>Edit Store</Text>
          </TouchableOpacity>
        </View>
      )}
      {shareCopied && !fullscreen && (
        <View style={styles.shareToast}>
          <Feather name="check-circle" size={13} color="#4ade80" />
          <Text style={styles.shareToastText}>Preview link copied — valid for 24 hours</Text>
        </View>
      )}

      {/* Page Selector */}
      {!fullscreen && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pageRow}
        >
          {PAGE_LABELS.map(pg => (
            <FilterChip
              key={pg.value}
              label={pg.label}
              active={currentPage === pg.value}
              onPress={() => setCurrentPage(pg.value)}
            />
          ))}
        </ScrollView>
      )}

      {/* Device Controls */}
      {!fullscreen && (
        <View style={styles.deviceControls}>
          {(['narrow', 'standard', 'wide'] as DeviceWidth[]).map(dw => (
            <TouchableOpacity
              key={dw}
              onPress={() => setDeviceWidth(dw)}
              style={[styles.deviceBtn, deviceWidth === dw && styles.deviceBtnActive]}
            >
              <Feather
                name="smartphone"
                size={dw === 'narrow' ? 14 : dw === 'standard' ? 17 : 20}
                color={deviceWidth === dw ? PURPLE_LIGHT : MUTED}
              />
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => setDarkMode(!darkMode)}
            style={[styles.deviceBtn, styles.deviceBtnSm]}
          >
            <Feather name={darkMode ? 'moon' : 'sun'} size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFullscreen(!fullscreen)}
            style={[styles.deviceBtn, styles.deviceBtnSm]}
          >
            <Feather name="maximize" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
          {/* Live WebView toggle */}
          <TouchableOpacity
            onPress={handleToggleWebView}
            style={[styles.deviceBtn, styles.deviceBtnSm, webViewMode && { backgroundColor: PURPLE_DIM }]}
            disabled={loadingWebView}
          >
            {loadingWebView
              ? <ActivityIndicator size="small" color={PURPLE_LIGHT} />
              : <Feather name="globe" size={ICON.sm} color={webViewMode ? PURPLE_LIGHT : MUTED} />
            }
          </TouchableOpacity>
        </View>
      )}
      {!fullscreen && webViewMode && (
        <View style={styles.webViewBadge}>
          <Feather name="globe" size={10} color={PURPLE_LIGHT} />
          <Text style={styles.webViewBadgeText}>Live HTML Preview — tap 🌐 to return to native preview</Text>
        </View>
      )}

      {/* Live WebView Mode */}
      {webViewMode && webViewHtml ? (
        <View style={[styles.phoneWrapper, { flex: 1 }]}>
          <View style={[styles.phoneFrame, { width: fullscreen ? screenWidth : phoneW, flex: 1, backgroundColor: '#0f0f1a' }]}>
            <View style={[styles.statusBar, { backgroundColor: '#000' }]} />
            <View style={styles.notch} />
            <WebView
              source={{ html: webViewHtml, baseUrl: 'about:blank' }}
              style={{ flex: 1 }}
              scrollEnabled
              showsVerticalScrollIndicator={false}
              originWhitelist={['*']}
            />
          </View>
        </View>
      ) : null}

      {/* Phone Frame — hidden when live WebView mode is active */}
      {!webViewMode && <View
        style={[
          styles.phoneWrapper,
          fullscreen && { flex: 1, paddingBottom: insets.bottom },
        ]}
      >
        <View
          style={[
            styles.phoneFrame,
            {
              width: fullscreen ? screenWidth : phoneW,
              height: fullscreen ? undefined : phoneH,
              flex: fullscreen ? 1 : undefined,
              backgroundColor: phoneBg,
            },
          ]}
        >
          {/* Status bar */}
          <View style={[styles.statusBar, { backgroundColor: darkMode ? '#000' : '#f0f0f0' }]} />
          {/* Notch */}
          <View style={styles.notch} />

          {/* Content */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ backgroundColor: phoneBg, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
          >
            {renderPageContent()}
          </ScrollView>
        </View>

        {/* Fullscreen exit */}
        {fullscreen && (
          <TouchableOpacity
            onPress={() => setFullscreen(false)}
            style={[styles.exitFullscreen, { top: insets.top + SP.sm }]}
          >
            <Feather name="x" size={ICON.md} color={FG} />
          </TouchableOpacity>
        )}
      </View>}

      {/* Selected Section Indicator */}
      {selectedSection && !fullscreen && (
        <View style={[styles.sectionIndicator, { paddingBottom: insets.bottom + SP.sm }]}>
          <Text style={styles.sectionIndicatorName}>{selectedSection.label}</Text>
          <TouchableOpacity
            onPress={() => router.push(('/store-editor?sectionId=' + selectedSection.id) as never)}
          >
            <Text style={styles.sectionIndicatorEdit}>Edit →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const previewStyles = StyleSheet.create({
  sectionBlock: {
    overflow: 'hidden',
    borderRadius: 0,
  },
  heroContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
  },
  heroHeading: {
    fontSize: 14,
    fontFamily: FONT.bold,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  heroBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  heroBtnText: {
    fontSize: 8,
    fontFamily: FONT.bold,
  },
  blockLabel: {
    fontSize: 10,
    fontFamily: FONT.semibold,
  },
  miniGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  miniCard: {
    width: '47%',
    height: 36,
    borderRadius: 4,
  },
  textLine: {
    height: 6,
    borderRadius: 3,
    width: '75%',
  },
  emailMock: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 4,
    width: '80%',
  },
  timerRow: {
    flexDirection: 'row',
    gap: 4,
  },
  timerBlock: {
    width: 22,
    height: 20,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerVal: {
    fontSize: 9,
    color: '#fff',
    fontFamily: FONT.bold,
  },
  postsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  postSquare: {
    flex: 1,
    height: 48,
    borderRadius: 4,
  },
  reviewRow: {
    flexDirection: 'row',
    gap: 4,
  },
  reviewCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 4,
    padding: 4,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 1,
  },
  productImage: {
    height: 180,
    width: '100%',
  },
  variantRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
    marginBottom: 8,
  },
  variantBtn: {
    width: 24,
    height: 20,
    borderRadius: 3,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addToCartBtn: {
    width: '100%',
    height: 28,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectionHeader: {
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  collectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 6,
    gap: 6,
  },
  collectionCard: {
    width: '47%',
    borderRadius: 4,
    padding: 6,
  },
  collectionCardImg: {
    height: 60,
    borderRadius: 3,
  },
  hamburgerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  hamburgerLogo: {
    width: 40,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  cartItemImg: {
    width: 36,
    height: 36,
    borderRadius: 4,
  },
  qtyBox: {
    width: 20,
    height: 20,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    marginTop: 4,
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE_DIM,
    borderWidth: 1,
    borderColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareBtnCopied: {
    borderColor: '#4ade80',
    backgroundColor: '#4ade8022',
  },
  shareToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingBottom: SP.xs,
  },
  shareToastText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: '#4ade80',
  },
  editBtn: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.md,
    backgroundColor: PURPLE,
  },
  editBtnText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: '#fff',
  },
  pageRow: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    gap: SP.sm,
  },
  deviceControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.xs,
    gap: SP.sm,
  },
  deviceBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceBtnActive: {
    borderColor: BORDER_ACTIVE,
    backgroundColor: PURPLE_DIM,
  },
  deviceBtnSm: {
    marginLeft: 'auto' as any,
  },
  webViewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingBottom: SP.xs,
  },
  webViewBadgeText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: PURPLE_LIGHT,
  },
  phoneWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SP.md,
  },
  phoneFrame: {
    borderRadius: 40,
    borderWidth: 6,
    borderColor: CARD_ELEVATED,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 16,
  },
  statusBar: {
    height: 12,
    width: '100%',
  },
  notch: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: 80,
    height: 20,
    backgroundColor: CARD_ELEVATED,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    zIndex: 10,
  },
  exitFullscreen: {
    position: 'absolute',
    right: SP.md,
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    backgroundColor: PURPLE,
  },
  sectionIndicatorName: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: '#fff',
  },
  sectionIndicatorEdit: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: '#fff',
  },
});

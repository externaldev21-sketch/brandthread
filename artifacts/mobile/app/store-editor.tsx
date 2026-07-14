import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  TextInput, StyleSheet, Alert, Switch, Animated, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
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
import {
  getStorefront, updateSection, toggleSection, deleteSection,
  duplicateSection, reorderSections, undoLastAction, redoLastAction,
  updateThemeSettings, updateBranding, saveDraftAnswers, autosaveStorefront,
  createVersion,
} from '@/services/storeService';
import {
  Storefront, StoreSection, StoreSectionType,
  SECTION_TYPE_LABELS, StoreThemeSettings,
} from '@/services/storeTypes';

type EditorMode = 'sections' | 'branding' | 'header' | 'footer' | 'product_page' | 'collection_page';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

const TABS: { value: EditorMode; label: string }[] = [
  { value: 'sections', label: 'Sections' },
  { value: 'branding', label: 'Branding' },
  { value: 'header', label: 'Header' },
  { value: 'footer', label: 'Footer' },
  { value: 'product_page', label: 'Product Page' },
  { value: 'collection_page', label: 'Collection' },
];

function ChipGroup({
  options, value, onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={chipStyles.row}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt}
          onPress={() => { Haptics.selectionAsync(); onChange(opt); }}
          style={[chipStyles.chip, value === opt && chipStyles.active]}
        >
          <Text style={[chipStyles.label, value === opt && chipStyles.activeLabel]}>
            {opt.charAt(0).toUpperCase() + opt.slice(1).replace(/_/g, ' ')}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADIUS.pill, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
  },
  active: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  label: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  activeLabel: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },
});

function FieldLabel({ children }: { children: string }) {
  return <Text style={fieldStyles.label}>{children}</Text>;
}

const fieldStyles = StyleSheet.create({
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.xs },
});

function FieldRow({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: SP.sm, marginBottom: SP.md }}>{children}</View>;
}

function StyledInput({
  value, onChange, placeholder, multiline, tall,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  tall?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={SUBTLE}
      multiline={multiline}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        inputStyles.input,
        focused && inputStyles.focused,
        multiline && inputStyles.multiline,
        tall && inputStyles.tall,
      ]}
    />
  );
}

const inputStyles = StyleSheet.create({
  input: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.sm,
    fontSize: FS.base, fontFamily: FONT.regular, color: FG, minHeight: 44,
  },
  focused: { borderColor: BORDER_ACTIVE },
  multiline: { minHeight: 80, textAlignVertical: 'top', paddingTop: SP.sm },
  tall: { minHeight: 120 },
});

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={swStyles.row}>
      <Text style={swStyles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: BORDER, true: PURPLE }}
        thumbColor={value ? PURPLE_LIGHT : MUTED}
      />
    </View>
  );
}

const swStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.xs },
  label: { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
});

// ─── Main Component ──────────────────────────────────────────────────────────

export default function StoreEditor() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const sectionPanelRef = useRef<View>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [store, setStore] = useState<Storefront | null>(null);
  const [activeSection, setActiveSection] = useState<StoreSection | null>(null);
  const [savingStatus, setSavingStatus] = useState<SaveStatus>('idle');
  const [undoAvailable, setUndoAvailable] = useState(false);
  const [redoAvailable, setRedoAvailable] = useState(false);
  const [mode, setMode] = useState<EditorMode>('sections');
  const [refreshing, setRefreshing] = useState(false);

  // Debounced local settings state for active section
  const [localSettings, setLocalSettings] = useState<Record<string, any>>({});

  async function load() {
    const s = await getStorefront();
    setStore(s);
    setUndoAvailable(s.undoStack.length > 0);
    setRedoAvailable(s.redoStack.length > 0);
    // If param sectionId provided, open that section
    if (params.sectionId) {
      const found = s.sections.find(sec => sec.id === params.sectionId);
      if (found) {
        setActiveSection(found);
        setLocalSettings(found.settings as Record<string, any>);
      }
    }
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  // Autosave on store change
  useEffect(() => {
    if (!store) return;
    setSavingStatus('saving');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        await autosaveStorefront({ sections: store.sections, branding: store.branding, themeSettings: store.themeSettings });
        setSavingStatus('saved');
      } catch {
        setSavingStatus('failed');
      }
    }, 1500);
  }, [store]);

  function triggerSectionUpdate(sectionId: string, newSettings: Record<string, any>) {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        const updated = await updateSection(sectionId, newSettings);
        setStore(updated);
        const found = updated.sections.find(s => s.id === sectionId);
        if (found) setActiveSection(found);
        setSavingStatus('saved');
      } catch {
        setSavingStatus('failed');
      }
    }, 800);
  }

  function handleLocalChange(key: string, val: any) {
    const next = { ...localSettings, [key]: val };
    setLocalSettings(next);
    if (activeSection) triggerSectionUpdate(activeSection.id, next);
  }

  async function handleUndo() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const s = await undoLastAction();
    setStore(s);
    setUndoAvailable(s.undoStack.length > 0);
    setRedoAvailable(s.redoStack.length > 0);
  }

  async function handleRedo() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const s = await redoLastAction();
    setStore(s);
    setUndoAvailable(s.undoStack.length > 0);
    setRedoAvailable(s.redoStack.length > 0);
  }

  async function handleToggle(id: string) {
    const s = await toggleSection(id);
    setStore(s);
  }

  async function handleDuplicate(id: string) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const s = await duplicateSection(id);
    setStore(s);
  }

  async function handleDelete(id: string, label: string) {
    Alert.alert('Delete Section', `Delete "${label}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const s = await deleteSection(id);
          setStore(s);
          if (activeSection?.id === id) setActiveSection(null);
        },
      },
    ]);
  }

  async function handleMoveUp(id: string) {
    if (!store) return;
    const sorted = [...store.sections].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(s => s.id === id);
    if (idx <= 0) return;
    const ids = sorted.map(s => s.id);
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
    const s = await reorderSections(ids);
    setStore(s);
  }

  async function handleMoveDown(id: string) {
    if (!store) return;
    const sorted = [...store.sections].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(s => s.id === id);
    if (idx < 0 || idx >= sorted.length - 1) return;
    const ids = sorted.map(s => s.id);
    [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
    const s = await reorderSections(ids);
    setStore(s);
  }

  async function handleThemeUpdate(partial: Partial<StoreThemeSettings>) {
    const s = await updateThemeSettings(partial);
    setStore(s);
  }

  function saveStatusColor() {
    if (savingStatus === 'saved') return SUCCESS;
    if (savingStatus === 'failed') return RED;
    return MUTED;
  }

  function saveStatusText() {
    if (savingStatus === 'saving') return 'Saving...';
    if (savingStatus === 'saved') return 'Saved';
    if (savingStatus === 'failed') return 'Failed';
    return '';
  }

  const sortedSections = store
    ? [...store.sections].sort((a, b) => a.order - b.order)
    : [];

  // ─── Section Settings Panel ─────────────────────────────────────────────────
  function renderSectionPanel() {
    if (!activeSection) return null;
    const s = activeSection;
    const ls = localSettings;

    function field(key: string, fallback: any = '') {
      return ls[key] !== undefined ? ls[key] : (s.settings as any)[key] ?? fallback;
    }

    return (
      <View ref={sectionPanelRef} style={panelStyles.root}>
        <View style={panelStyles.header}>
          <Text style={panelStyles.title}>{s.label} Settings</Text>
          <TouchableOpacity onPress={() => setActiveSection(null)} style={panelStyles.closeBtn}>
            <Feather name="x" size={ICON.md} color={MUTED} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SP.xl }}>
          {/* Common fields */}
          <FieldRow>
            <FieldLabel>Heading</FieldLabel>
            <StyledInput value={field('heading')} onChange={v => handleLocalChange('heading', v)} placeholder="Section heading" />
          </FieldRow>

          {s.type !== 'announcement' && s.type !== 'spacer' && s.type !== 'drop_countdown' && (
            <FieldRow>
              <FieldLabel>Description</FieldLabel>
              <StyledInput value={field('description')} onChange={v => handleLocalChange('description', v)} placeholder="Description" multiline />
            </FieldRow>
          )}

          <FieldRow>
            <SwitchRow label="Visible" value={field('visible', true)} onChange={v => handleLocalChange('visible', v)} />
          </FieldRow>

          <FieldRow>
            <FieldLabel>Background Color</FieldLabel>
            <StyledInput value={field('backgroundColor')} onChange={v => handleLocalChange('backgroundColor', v)} placeholder="#000000" />
          </FieldRow>

          <FieldRow>
            <FieldLabel>Text Color</FieldLabel>
            <StyledInput value={field('textColor')} onChange={v => handleLocalChange('textColor', v)} placeholder="#ffffff" />
          </FieldRow>

          {/* Hero fields */}
          {(s.type === 'hero_image' || s.type === 'hero_video' || s.type === 'hero_slideshow') && (
            <>
              <FieldRow>
                <FieldLabel>Button Label</FieldLabel>
                <StyledInput value={field('buttonLabel')} onChange={v => handleLocalChange('buttonLabel', v)} placeholder="Shop Now" />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Button Destination</FieldLabel>
                <StyledInput value={field('buttonDestination')} onChange={v => handleLocalChange('buttonDestination', v)} placeholder="/collections/all" />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Text Alignment</FieldLabel>
                <ChipGroup options={['left', 'center', 'right']} value={field('textAlignment', 'center')} onChange={v => handleLocalChange('textAlignment', v)} />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Section Height</FieldLabel>
                <ChipGroup options={['short', 'medium', 'tall', 'full']} value={field('sectionHeight', 'medium')} onChange={v => handleLocalChange('sectionHeight', v)} />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Content Position</FieldLabel>
                <ChipGroup options={['top', 'center', 'bottom']} value={field('contentPosition', 'center')} onChange={v => handleLocalChange('contentPosition', v)} />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Overlay Strength (0–100)</FieldLabel>
                <StyledInput value={String(field('overlayStrength', 40))} onChange={v => handleLocalChange('overlayStrength', parseInt(v) || 0)} placeholder="40" />
              </FieldRow>
              {s.type === 'hero_video' && (
                <>
                  <SwitchRow label="Muted" value={field('muted', true)} onChange={v => handleLocalChange('muted', v)} />
                  <SwitchRow label="Autoplay" value={field('autoplay', true)} onChange={v => handleLocalChange('autoplay', v)} />
                  <SwitchRow label="Loop" value={field('loop', true)} onChange={v => handleLocalChange('loop', v)} />
                </>
              )}
              {s.type === 'hero_slideshow' && (
                <FieldRow>
                  <Text style={{ color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium }}>
                    Slides: {(field('slides', []) as any[]).length}
                  </Text>
                  <TouchableOpacity>
                    <Text style={{ color: PURPLE_LIGHT, fontSize: FS.sm, fontFamily: FONT.semibold }}>Edit Slides →</Text>
                  </TouchableOpacity>
                </FieldRow>
              )}
            </>
          )}

          {/* Product Grid / Featured Collection */}
          {(s.type === 'product_grid' || s.type === 'featured_collection') && (
            <>
              <FieldRow>
                <FieldLabel>Columns</FieldLabel>
                <ChipGroup options={['1', '2', '3', '4']} value={String(field('columns', 2))} onChange={v => handleLocalChange('columns', parseInt(v))} />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Collection</FieldLabel>
                <ChipGroup
                  options={['new_arrivals', 'best_sellers', 'pre_orders', 'featured']}
                  value={field('collectionRef', 'new_arrivals')}
                  onChange={v => handleLocalChange('collectionRef', v)}
                />
              </FieldRow>
              <SwitchRow label="Quick Add" value={field('quickAdd', false)} onChange={v => handleLocalChange('quickAdd', v)} />
            </>
          )}

          {/* Drop Countdown */}
          {s.type === 'drop_countdown' && (
            <>
              <FieldRow>
                <FieldLabel>Drop Date</FieldLabel>
                <StyledInput value={field('dropDate')} onChange={v => handleLocalChange('dropDate', v)} placeholder="2025-01-01T00:00:00Z" />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Style</FieldLabel>
                <ChipGroup options={['minimal', 'bold', 'flip', 'digital']} value={field('countdownStyle', 'bold')} onChange={v => handleLocalChange('countdownStyle', v)} />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Expired Message</FieldLabel>
                <StyledInput value={field('expiredMessage')} onChange={v => handleLocalChange('expiredMessage', v)} placeholder="Drop has ended." />
              </FieldRow>
            </>
          )}

          {/* Brand Story */}
          {s.type === 'brand_story' && (
            <>
              <FieldRow>
                <FieldLabel>Story Text</FieldLabel>
                <StyledInput value={field('storyText')} onChange={v => handleLocalChange('storyText', v)} placeholder="Tell your brand story..." multiline tall />
              </FieldRow>
              <FieldRow>
                <FieldLabel>Text Alignment</FieldLabel>
                <ChipGroup options={['left', 'center', 'right']} value={field('textAlignment', 'center')} onChange={v => handleLocalChange('textAlignment', v)} />
              </FieldRow>
            </>
          )}

          {/* Announcement */}
          {s.type === 'announcement' && (
            <>
              <FieldRow>
                <FieldLabel>Link</FieldLabel>
                <StyledInput value={field('link')} onChange={v => handleLocalChange('link', v)} placeholder="/collections/sale" />
              </FieldRow>
              <SwitchRow label="Dismissible" value={field('dismissible', true)} onChange={v => handleLocalChange('dismissible', v)} />
              <SwitchRow label="Sticky" value={field('sticky', false)} onChange={v => handleLocalChange('sticky', v)} />
            </>
          )}

          {/* Newsletter */}
          {s.type === 'newsletter' && (
            <FieldRow>
              <FieldLabel>Button Label</FieldLabel>
              <StyledInput value={field('buttonLabel', 'Subscribe')} onChange={v => handleLocalChange('buttonLabel', v)} placeholder="Subscribe" />
            </FieldRow>
          )}

          {/* FAQ */}
          {s.type === 'faq' && (
            <>
              <FieldLabel>FAQs</FieldLabel>
              {((field('faqs', []) as { q: string; a: string }[])).map((faq, i) => (
                <View key={i} style={panelStyles.faqItem}>
                  <StyledInput
                    value={faq.q}
                    onChange={v => {
                      const faqs = [...(field('faqs', []) as { q: string; a: string }[])];
                      faqs[i] = { ...faqs[i], q: v };
                      handleLocalChange('faqs', faqs);
                    }}
                    placeholder="Question"
                  />
                  <StyledInput
                    value={faq.a}
                    onChange={v => {
                      const faqs = [...(field('faqs', []) as { q: string; a: string }[])];
                      faqs[i] = { ...faqs[i], a: v };
                      handleLocalChange('faqs', faqs);
                    }}
                    placeholder="Answer"
                    multiline
                  />
                  <TouchableOpacity
                    onPress={() => {
                      const faqs = (field('faqs', []) as { q: string; a: string }[]).filter((_, fi) => fi !== i);
                      handleLocalChange('faqs', faqs);
                    }}
                  >
                    <Text style={{ color: RED, fontSize: FS.sm, fontFamily: FONT.medium }}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                onPress={() => {
                  const faqs = [...(field('faqs', []) as { q: string; a: string }[]), { q: '', a: '' }];
                  handleLocalChange('faqs', faqs);
                }}
                style={panelStyles.addFaqBtn}
              >
                <Feather name="plus" size={ICON.sm} color={PURPLE_LIGHT} />
                <Text style={{ color: PURPLE_LIGHT, fontSize: FS.sm, fontFamily: FONT.semibold }}>Add Question</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  // ─── Branding Tab ───────────────────────────────────────────────────────────
  function renderBranding() {
    if (!store) return null;
    const colors = store.branding.colors;
    const typo = store.branding.typography;
    const br = store.branding;

    async function updateColor(key: string, val: string) {
      const s = await updateBranding({ colors: { ...colors, [key]: val } });
      setStore(s);
    }
    async function updateBrandingField(partial: any) {
      const s = await updateBranding(partial);
      setStore(s);
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
        <SectionHeader title="Colors" />
        {(['primary', 'secondary', 'accent', 'background', 'text'] as const).map(key => (
          <View key={key} style={brandStyles.colorRow}>
            <View style={[brandStyles.colorSwatch, { backgroundColor: (colors as any)[key] }]} />
            <Text style={brandStyles.colorLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
            <TextInput
              value={(colors as any)[key]}
              onChangeText={v => updateColor(key, v)}
              style={brandStyles.colorInput}
              placeholderTextColor={SUBTLE}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
        ))}
        <TouchableOpacity style={brandStyles.resetBtn}>
          <Text style={{ color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium }}>Reset to Theme Defaults</Text>
        </TouchableOpacity>

        <SectionHeader title="Typography" style={{ marginTop: SP.md }} />
        <FieldRow>
          <FieldLabel>Style</FieldLabel>
          <ChipGroup
            options={['modern', 'luxury', 'minimal']}
            value={typo.style}
            onChange={v => updateBrandingField({ typography: { ...typo, style: v } })}
          />
          <TouchableOpacity>
            <Text style={{ color: PURPLE_LIGHT, fontSize: FS.sm, fontFamily: FONT.medium }}>More options →</Text>
          </TouchableOpacity>
        </FieldRow>
        <FieldRow>
          <FieldLabel>Text Case</FieldLabel>
          <ChipGroup
            options={['none', 'uppercase', 'lowercase', 'capitalize']}
            value={typo.textCase}
            onChange={v => updateBrandingField({ typography: { ...typo, textCase: v } })}
          />
        </FieldRow>

        <SectionHeader title="Button & Shape" style={{ marginTop: SP.md }} />
        <FieldRow>
          <FieldLabel>Button Style</FieldLabel>
          <ChipGroup
            options={['filled', 'outline', 'ghost', 'underline']}
            value={br.buttonStyle}
            onChange={v => updateBrandingField({ buttonStyle: v })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Corner Radius</FieldLabel>
          <ChipGroup
            options={['sharp', 'subtle', 'rounded', 'pill']}
            value={br.cornerRadius}
            onChange={v => updateBrandingField({ cornerRadius: v })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Icon Style</FieldLabel>
          <ChipGroup
            options={['outline', 'filled', 'duotone']}
            value={br.iconStyle}
            onChange={v => updateBrandingField({ iconStyle: v })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Animation Level</FieldLabel>
          <ChipGroup
            options={['none', 'subtle', 'standard', 'expressive']}
            value={br.animationLevel}
            onChange={v => updateBrandingField({ animationLevel: v })}
          />
        </FieldRow>
      </ScrollView>
    );
  }

  // ─── Header Tab ─────────────────────────────────────────────────────────────
  function renderHeader() {
    if (!store) return null;
    const ts = store.themeSettings;
    const ab = ts.announcementBar;

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
        <FieldRow>
          <FieldLabel>Logo Position</FieldLabel>
          <ChipGroup
            options={['left', 'center', 'right']}
            value={ts.headerLogoPosition}
            onChange={v => handleThemeUpdate({ headerLogoPosition: v as any })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Menu Style</FieldLabel>
          <ChipGroup
            options={['inline', 'hamburger', 'mega']}
            value={ts.headerMenuStyle}
            onChange={v => handleThemeUpdate({ headerMenuStyle: v as any })}
          />
        </FieldRow>
        <SwitchRow label="Search" value={ts.headerSearch} onChange={v => handleThemeUpdate({ headerSearch: v })} />
        <SwitchRow label="Cart" value={ts.headerCart} onChange={v => handleThemeUpdate({ headerCart: v })} />
        <SwitchRow label="Account" value={ts.headerAccount} onChange={v => handleThemeUpdate({ headerAccount: v })} />
        <SwitchRow label="Sticky Header" value={ts.stickyHeader} onChange={v => handleThemeUpdate({ stickyHeader: v })} />
        <SwitchRow label="Transparent Header" value={ts.transparentHeader} onChange={v => handleThemeUpdate({ transparentHeader: v })} />

        <View style={styles.divider} />
        <SectionHeader title="Announcement Bar" />
        <SwitchRow
          label="Enable"
          value={ab.enabled}
          onChange={v => handleThemeUpdate({ announcementBar: { ...ab, enabled: v } })}
        />
        {ab.enabled && (
          <>
            <FieldRow>
              <FieldLabel>Text</FieldLabel>
              <StyledInput
                value={ab.text}
                onChange={v => handleThemeUpdate({ announcementBar: { ...ab, text: v } })}
                placeholder="Free shipping on orders over $150"
              />
            </FieldRow>
            <FieldRow>
              <FieldLabel>Background Color</FieldLabel>
              <StyledInput
                value={ab.backgroundColor}
                onChange={v => handleThemeUpdate({ announcementBar: { ...ab, backgroundColor: v } })}
                placeholder="#7c3aed"
              />
            </FieldRow>
            <FieldRow>
              <FieldLabel>Text Color</FieldLabel>
              <StyledInput
                value={ab.textColor}
                onChange={v => handleThemeUpdate({ announcementBar: { ...ab, textColor: v } })}
                placeholder="#ffffff"
              />
            </FieldRow>
            <SwitchRow label="Dismissible" value={ab.dismissible} onChange={v => handleThemeUpdate({ announcementBar: { ...ab, dismissible: v } })} />
            <SwitchRow label="Sticky" value={ab.sticky} onChange={v => handleThemeUpdate({ announcementBar: { ...ab, sticky: v } })} />
            <SwitchRow label="Countdown" value={ab.hasCountdown} onChange={v => handleThemeUpdate({ announcementBar: { ...ab, hasCountdown: v } })} />
            {ab.hasCountdown && (
              <FieldRow>
                <FieldLabel>Countdown Date</FieldLabel>
                <StyledInput
                  value={ab.countdownDate ?? ''}
                  onChange={v => handleThemeUpdate({ announcementBar: { ...ab, countdownDate: v } })}
                  placeholder="2025-12-31T00:00:00Z"
                />
              </FieldRow>
            )}
          </>
        )}
      </ScrollView>
    );
  }

  // ─── Footer Tab ─────────────────────────────────────────────────────────────
  function renderFooter() {
    if (!store) return null;
    const ts = store.themeSettings;
    const sl = ts.footerSocialLinks;

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
        <SwitchRow label="Newsletter" value={ts.footerNewsletter} onChange={v => handleThemeUpdate({ footerNewsletter: v })} />
        <SwitchRow label="Policies" value={ts.footerPolicies} onChange={v => handleThemeUpdate({ footerPolicies: v })} />
        <SwitchRow label="Payment Icons" value={ts.footerPaymentIcons} onChange={v => handleThemeUpdate({ footerPaymentIcons: v })} />

        <View style={styles.divider} />
        <SectionHeader title="Social Links" />
        {(['instagram', 'tiktok', 'twitter', 'youtube', 'facebook'] as const).map(platform => (
          <FieldRow key={platform}>
            <FieldLabel>{platform.charAt(0).toUpperCase() + platform.slice(1)}</FieldLabel>
            <StyledInput
              value={sl[platform] ?? ''}
              onChange={v => handleThemeUpdate({ footerSocialLinks: { ...sl, [platform]: v } })}
              placeholder={`https://${platform}.com/yourbrand`}
            />
          </FieldRow>
        ))}

        <View style={styles.divider} />
        <FieldRow>
          <FieldLabel>Contact Info</FieldLabel>
          <StyledInput value={ts.footerContactInfo} onChange={v => handleThemeUpdate({ footerContactInfo: v })} placeholder="hello@yourbrand.com" />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Copyright</FieldLabel>
          <StyledInput value={ts.footerCopyright} onChange={v => handleThemeUpdate({ footerCopyright: v })} placeholder="© 2025 Your Brand" />
        </FieldRow>
      </ScrollView>
    );
  }

  // ─── Product Page Tab ───────────────────────────────────────────────────────
  function renderProductPage() {
    if (!store) return null;
    const pp = store.themeSettings.productPage;

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
        <FieldRow>
          <FieldLabel>Media Layout</FieldLabel>
          <ChipGroup
            options={['stacked', 'side_by_side', 'full_width']}
            value={pp.mediaLayout}
            onChange={v => handleThemeUpdate({ productPage: { ...pp, mediaLayout: v as any } })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Image Size</FieldLabel>
          <ChipGroup
            options={['small', 'medium', 'large']}
            value={pp.imageSize}
            onChange={v => handleThemeUpdate({ productPage: { ...pp, imageSize: v as any } })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Info Position</FieldLabel>
          <ChipGroup
            options={['right', 'below']}
            value={pp.infoPosition}
            onChange={v => handleThemeUpdate({ productPage: { ...pp, infoPosition: v as any } })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Variant Style</FieldLabel>
          <ChipGroup
            options={['buttons', 'dropdown', 'swatches']}
            value={pp.variantStyle}
            onChange={v => handleThemeUpdate({ productPage: { ...pp, variantStyle: v as any } })}
          />
        </FieldRow>
        <View style={styles.divider} />
        <SwitchRow label="Size Guide" value={pp.sizeGuide} onChange={v => handleThemeUpdate({ productPage: { ...pp, sizeGuide: v } })} />
        <SwitchRow label="Reviews" value={pp.reviews} onChange={v => handleThemeUpdate({ productPage: { ...pp, reviews: v } })} />
        <SwitchRow label="Sticky Cart" value={pp.stickyCart} onChange={v => handleThemeUpdate({ productPage: { ...pp, stickyCart: v } })} />
        <SwitchRow label="Related Products" value={pp.relatedProducts} onChange={v => handleThemeUpdate({ productPage: { ...pp, relatedProducts: v } })} />
        <SwitchRow label="Seller Link" value={pp.sellerLink} onChange={v => handleThemeUpdate({ productPage: { ...pp, sellerLink: v } })} />
        <SwitchRow label="Seller Content" value={pp.sellerContent} onChange={v => handleThemeUpdate({ productPage: { ...pp, sellerContent: v } })} />
      </ScrollView>
    );
  }

  // ─── Collection Page Tab ────────────────────────────────────────────────────
  function renderCollectionPage() {
    if (!store) return null;
    const cp = store.themeSettings.collectionPage;

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
        <FieldRow>
          <FieldLabel>Columns</FieldLabel>
          <ChipGroup
            options={['1', '2', '3', '4']}
            value={String(cp.columns)}
            onChange={v => handleThemeUpdate({ collectionPage: { ...cp, columns: parseInt(v) as any } })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Card Style</FieldLabel>
          <ChipGroup
            options={['standard', 'minimal', 'overlay']}
            value={cp.cardStyle}
            onChange={v => handleThemeUpdate({ collectionPage: { ...cp, cardStyle: v as any } })}
          />
        </FieldRow>
        <FieldRow>
          <FieldLabel>Pagination</FieldLabel>
          <ChipGroup
            options={['paginated', 'infinite']}
            value={cp.pagination}
            onChange={v => handleThemeUpdate({ collectionPage: { ...cp, pagination: v as any } })}
          />
        </FieldRow>
        <View style={styles.divider} />
        <SwitchRow label="Filters" value={cp.filters} onChange={v => handleThemeUpdate({ collectionPage: { ...cp, filters: v } })} />
        <SwitchRow label="Sorting" value={cp.sorting} onChange={v => handleThemeUpdate({ collectionPage: { ...cp, sorting: v } })} />
        <SwitchRow label="Quick Add" value={cp.quickAdd} onChange={v => handleThemeUpdate({ collectionPage: { ...cp, quickAdd: v } })} />
      </ScrollView>
    );
  }

  // ─── Sections Tab ───────────────────────────────────────────────────────────
  function renderSectionRow({ item: section }: { item: StoreSection }) {
    const isActive = activeSection?.id === section.id;

    function getSummary() {
      const s = section.settings;
      if (s.heading) return `"${s.heading}"`;
      return section.type.replace(/_/g, ' ');
    }

    return (
      <View style={[sectionStyles.row, isActive && sectionStyles.rowActive]}>
        <View style={sectionStyles.rowTop}>
          <View style={sectionStyles.rowLeft}>
            <Feather name="menu" size={ICON.sm} color={SUBTLE} />
            <View style={[sectionStyles.enabledDot, { backgroundColor: section.enabled ? SUCCESS : MUTED }]} />
            <View style={{ flex: 1 }}>
              <Text style={sectionStyles.sectionLabel}>{section.label}</Text>
              <Text style={sectionStyles.sectionSummary} numberOfLines={1}>{getSummary()}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync();
              if (isActive) {
                setActiveSection(null);
              } else {
                setActiveSection(section);
                setLocalSettings(section.settings as Record<string, any>);
              }
            }}
            style={sectionStyles.editBtn}
          >
            <Text style={sectionStyles.editBtnText}>{isActive ? 'Close' : 'Edit'}</Text>
            <Feather name={isActive ? 'chevron-up' : 'chevron-right'} size={ICON.xs} color={PURPLE_LIGHT} />
          </TouchableOpacity>
        </View>

        <View style={sectionStyles.rowActions}>
          <TouchableOpacity onPress={() => handleToggle(section.id)} style={sectionStyles.actionBtn}>
            <Text style={sectionStyles.actionBtnText}>{section.enabled ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDuplicate(section.id)} style={sectionStyles.actionBtn}>
            <Text style={sectionStyles.actionBtnText}>Duplicate</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(section.id, section.label)} style={[sectionStyles.actionBtn, sectionStyles.deleteBtn]}>
            <Text style={[sectionStyles.actionBtnText, { color: RED }]}>Delete</Text>
          </TouchableOpacity>
          <View style={sectionStyles.orderBtns}>
            <TouchableOpacity onPress={() => handleMoveUp(section.id)} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
              <Feather name="chevron-up" size={ICON.sm} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleMoveDown(section.id)} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
              <Feather name="chevron-down" size={ICON.sm} color={MUTED} />
            </TouchableOpacity>
          </View>
        </View>

        {isActive && renderSectionPanel()}
      </View>
    );
  }

  function renderSections() {
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.sectionsTopRow}>
          <TouchableOpacity
            onPress={() => router.push('/store-sections' as never)}
            style={styles.addSectionBtn}
          >
            <Feather name="plus" size={ICON.sm} color={PURPLE_LIGHT} />
            <Text style={styles.addSectionBtnText}>Add Section</Text>
          </TouchableOpacity>
        </View>

        {sortedSections.length === 0 ? (
          <EmptyState
            icon="layout"
            title="No sections yet"
            description="Add sections to build your store homepage."
            action={{
              label: 'Add Section',
              onPress: () => router.push('/store-sections' as never),
              icon: 'plus',
            }}
          />
        ) : (
          <FlatList
            data={sortedSections}
            keyExtractor={item => item.id}
            renderItem={renderSectionRow}
            contentContainerStyle={{ padding: SP.md, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={PURPLE} />
            }
          />
        )}
      </View>
    );
  }

  function renderTabContent() {
    switch (mode) {
      case 'sections': return renderSections();
      case 'branding': return renderBranding();
      case 'header': return renderHeader();
      case 'footer': return renderFooter();
      case 'product_page': return renderProductPage();
      case 'collection_page': return renderCollectionPage();
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow1}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Store</Text>
          {savingStatus !== 'idle' && (
            <Text style={[styles.saveStatus, { color: saveStatusColor() }]}>{saveStatusText()}</Text>
          )}
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleUndo}
              disabled={!undoAvailable}
              style={[styles.undoBtn, !undoAvailable && styles.undoBtnDisabled]}
            >
              <Feather name="corner-up-left" size={ICON.sm} color={undoAvailable ? FG : SUBTLE} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRedo}
              disabled={!redoAvailable}
              style={[styles.undoBtn, !redoAvailable && styles.undoBtnDisabled]}
            >
              <Feather name="corner-up-right" size={ICON.sm} color={redoAvailable ? FG : SUBTLE} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/store-preview' as never)}
              style={styles.headerBtn}
            >
              <Text style={styles.headerBtnText}>Preview</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/store-publish' as never)}
              style={[styles.headerBtn, { backgroundColor: PURPLE }]}
            >
              <Text style={[styles.headerBtnText, { color: '#fff' }]}>Publish</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Tab Bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBar}
      >
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.value}
            onPress={() => { Haptics.selectionAsync(); setMode(tab.value); }}
            style={[styles.tab, mode === tab.value && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, mode === tab.value && styles.tabLabelActive]}>
              {tab.label}
            </Text>
            {mode === tab.value && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Tab Content */}
      <View style={{ flex: 1 }}>
        {renderTabContent()}
      </View>
    </View>
  );
}

// ─── StyleSheets ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: { paddingHorizontal: SP.md, paddingVertical: SP.xs },
  headerRow1: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 },
  saveStatus: { fontSize: FS.xs, fontFamily: FONT.medium },
  headerRight: { marginLeft: 'auto' as any, flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  undoBtn: {
    width: 32, height: 32, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  undoBtnDisabled: { opacity: 0.4 },
  headerBtn: {
    paddingHorizontal: SP.sm, paddingVertical: 6,
    borderRadius: RADIUS.sm, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER,
  },
  headerBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },
  tabBar: { paddingHorizontal: SP.md, paddingVertical: SP.xs, gap: 4 },
  tab: {
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    position: 'relative', alignItems: 'center',
  },
  tabActive: {},
  tabLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabLabelActive: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: SP.sm, right: SP.sm,
    height: 2, backgroundColor: PURPLE, borderRadius: RADIUS.pill,
  },
  tabContent: { padding: SP.md, paddingBottom: 120 },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.md },
  sectionsTopRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.sm,
  },
  addSectionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    borderRadius: RADIUS.md, backgroundColor: PURPLE_DIM,
    borderWidth: 1, borderColor: BORDER_ACTIVE,
  },
  addSectionBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
});

const sectionStyles = StyleSheet.create({
  row: {
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
    marginBottom: SP.sm, overflow: 'hidden',
  },
  rowActive: { borderColor: BORDER_ACTIVE },
  rowTop: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.sm, paddingVertical: SP.sm,
    justifyContent: 'space-between',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, flex: 1 },
  enabledDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  sectionSummary: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
    borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM,
  },
  editBtnText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  rowActions: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.sm, paddingBottom: SP.sm, gap: SP.sm,
  },
  actionBtn: {
    paddingHorizontal: SP.sm, paddingVertical: 5,
    borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED,
    borderWidth: 1, borderColor: BORDER,
  },
  deleteBtn: { borderColor: RED + '44' },
  actionBtnText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  orderBtns: {
    marginLeft: 'auto' as any, flexDirection: 'row', gap: SP.xs,
  },
});

const panelStyles = StyleSheet.create({
  root: {
    borderTopWidth: 1, borderTopColor: BORDER,
    backgroundColor: SURFACE, padding: SP.md,
    maxHeight: 500,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: SP.md,
  },
  title: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  closeBtn: {
    width: 28, height: 28, borderRadius: RADIUS.sm,
    backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center',
  },
  faqItem: {
    gap: SP.sm, marginBottom: SP.md,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER, padding: SP.sm,
  },
  addFaqBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    paddingVertical: SP.sm, marginTop: SP.xs,
  },
});

const brandStyles = StyleSheet.create({
  colorRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: SP.sm, marginBottom: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, paddingVertical: SP.sm,
  },
  colorSwatch: { width: 40, height: 40, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER },
  colorLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, width: 80 },
  colorInput: {
    flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
    backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
    borderWidth: 1, borderColor: BORDER,
  },
  resetBtn: {
    alignItems: 'center', paddingVertical: SP.sm, marginTop: SP.xs,
  },
});

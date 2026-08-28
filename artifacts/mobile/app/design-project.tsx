/**
 * Brandthread Design Studio — Project Creation Wizard (6 steps)
 */
import React, { useState, useEffect } from 'react';
import { useColors } from '@/hooks/useColors';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, CARD_ELEVATED,
  BORDER, BORDER_ACTIVE, BORDER_SUBTLE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM,
  SUCCESS, BLUE, ORANGE, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadCard,
  PrimaryButton, SecondaryButton,
} from '@/components/BrandthreadUI';
import { createProject } from '@/services/designService';
import {
  DesignProjectType, DesignCanvas, GarmentType,
  GARMENT_TEMPLATES, CANVAS_PRESETS, PROJECT_TYPE_LABELS,
} from '@/services/designTypes';

// ─── Step type definitions ────────────────────────────────────────────────────

type GarmentTemplate = typeof GARMENT_TEMPLATES[number];
type CanvasPreset = typeof CANVAS_PRESETS[number];

type ProjectTypeOption = {
  type: DesignProjectType;
  icon: string;
  label: string;
  desc: string;
  accent: string;
};

const PROJECT_TYPE_OPTIONS: ProjectTypeOption[] = [
  { type: 'garment',   icon: 'layers',      label: 'Garment Design',   desc: 'Design apparel — tees, hoodies, hats & more', accent: PURPLE },
  { type: 'canvas',    icon: 'edit-2',      label: 'Free Canvas',      desc: 'Open canvas for any creative work',           accent: CYAN },
  { type: 'mockup',    icon: 'box',         label: 'Product Mockup',   desc: 'Photorealistic product visuals',               accent: ORANGE },
  { type: 'campaign',  icon: 'trending-up', label: 'Campaign Image',   desc: 'Multi-format marketing content',               accent: BLUE },
  { type: 'social',    icon: 'instagram',   label: 'Social Content',   desc: 'Posts, stories & reels content',               accent: PURPLE_LIGHT },
  { type: 'packaging', icon: 'package',     label: 'Packaging',        desc: 'Box, bag & label design',                      accent: GOLD },
];

const BG_OPTIONS: { label: string; value: string; icon: string }[] = [
  { label: 'Transparent', value: 'transparent', icon: 'slash' },
  { label: 'White',       value: '#FFFFFF',      icon: 'circle' },
  { label: 'Black',       value: '#000000',      icon: 'disc' },
  { label: 'Custom',      value: 'custom',       icon: 'droplet' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeAccent(type: DesignProjectType): string {
  switch (type) {
    case 'garment':   return PURPLE;
    case 'canvas':    return CYAN;
    case 'mockup':    return ORANGE;
    case 'campaign':  return BLUE;
    case 'social':    return PURPLE_LIGHT;
    case 'packaging': return GOLD;
    default:          return PURPLE;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StepHeaderProps {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
}

function StepHeader({ step, total, title, subtitle }: StepHeaderProps) {
  const pct = (step / total) * 100;
  return (
    <View style={sh.root}>
      <View style={sh.barBg}>
        <LinearGradient colors={GRAD_PRIMARY} style={[sh.barFill, { width: `${pct}%` }]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
      </View>
      <Text style={sh.stepCount}>Step {step} of {total}</Text>
      <Text style={sh.title}>{title}</Text>
      {subtitle ? <Text style={sh.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const sh = StyleSheet.create({
  root:     { paddingHorizontal: SP.lg, paddingTop: SP.md, paddingBottom: SP.sm },
  barBg:    { height: 3, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden', marginBottom: SP.md },
  barFill:  { height: 3, borderRadius: 2 },
  stepCount:{ fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED, marginBottom: SP.xs },
  title:    { fontFamily: FONT.bold, fontSize: FS.xl, color: FG, marginBottom: 4 },
  subtitle: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DesignProjectScreen() {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string; garmentType?: string }>();

  const [step, setStep] = useState(1);
  const [projectType, setProjectType] = useState<DesignProjectType | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<GarmentTemplate | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<CanvasPreset | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(1080);
  const [canvasHeight, setCanvasHeight] = useState(1080);
  const [useCustomDims, setUseCustomDims] = useState(false);
  const [backgroundHex, setBackgroundHex] = useState('#000000');
  const [bgMode, setBgMode] = useState<string>('#000000');
  const [customHex, setCustomHex] = useState('#1A1A2E');
  const [projectName, setProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Apply URL params on mount
  useEffect(() => {
    const typeParam = params.type as DesignProjectType | undefined;
    const garmentParam = params.garmentType as GarmentType | undefined;
    if (typeParam) {
      setProjectType(typeParam);
      if (typeParam === 'garment' && garmentParam) {
        const tmpl = GARMENT_TEMPLATES.find(t => t.garmentType === garmentParam) ?? null;
        setSelectedTemplate(tmpl);
        if (tmpl) setProjectName(tmpl.label);
        setStep(3);
      } else {
        setStep(2);
      }
    }
  }, []);

  function goBack() {
    if (step === 1) { router.back(); return; }
    setStep(s => s - 1);
  }

  function selectType(type: DesignProjectType) {
    setProjectType(type);
    setProjectName(PROJECT_TYPE_LABELS[type]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(2);
  }

  function selectTemplate(tmpl: GarmentTemplate) {
    setSelectedTemplate(tmpl);
    setProjectName(tmpl.label);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function selectPreset(preset: CanvasPreset) {
    setSelectedPreset(preset);
    setCanvasWidth(preset.width);
    setCanvasHeight(preset.height);
    setProjectName(preset.label);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function selectBg(value: string) {
    setBgMode(value);
    if (value !== 'custom') setBackgroundHex(value);
    else setBackgroundHex(customHex);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function handleCreate() {
    if (!projectType) return;
    try {
      setIsCreating(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const canvas: Partial<DesignCanvas> = {
        width: canvasWidth,
        height: canvasHeight,
        backgroundHex,
      };
      const garmentType = projectType === 'garment' && selectedTemplate
        ? selectedTemplate.garmentType
        : undefined;
      const garmentColor = projectType === 'garment' && selectedTemplate
        ? selectedTemplate.defaultColor
        : undefined;
      const project = await createProject(
        projectType,
        projectName || PROJECT_TYPE_LABELS[projectType],
        canvas,
        garmentType,
        garmentColor,
      );
      router.replace(`/design-canvas?id=${project.id}` as any);
    } catch (err) {
      Alert.alert('Error', 'Could not create project. Please try again.');
    } finally {
      setIsCreating(false);
    }
  }

  const accent = projectType ? typeAccent(projectType) : PURPLE;
  const canProceedStep2 = projectType === 'garment' ? selectedTemplate !== null : selectedPreset !== null;
  const finalName = projectName || (projectType ? PROJECT_TYPE_LABELS[projectType] : 'New Project');

  return (
    <BrandthreadScreen>
      {/* Nav header */}
      <View style={styles.navRow}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>New Project</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ── Step 1: Choose type ── */}
        {step === 1 && (
          <View>
            <StepHeader step={1} total={6} title="What are you creating?" subtitle="Choose the type of project to start." />
            <View style={styles.typeGrid}>
              {PROJECT_TYPE_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.type}
                  style={[styles.typeCard, projectType === opt.type && { borderColor: opt.accent }]}
                  onPress={() => selectType(opt.type)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.typeIcon, { backgroundColor: opt.accent + '22' }]}>
                    <Feather name={opt.icon as any} size={ICON.lg} color={opt.accent} />
                  </View>
                  <Text style={styles.typeLabel}>{opt.label}</Text>
                  <Text style={styles.typeDesc}>{opt.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── Step 2: Choose template ── */}
        {step === 2 && (
          <View>
            <StepHeader
              step={2}
              total={6}
              title={projectType === 'garment' ? 'Choose a garment' : 'Choose a canvas'}
              subtitle={projectType === 'garment' ? 'Select the garment type for your design.' : 'Pick a size preset to start with.'}
            />
            {projectType === 'garment' ? (
              <View style={styles.twoColGrid}>
                {GARMENT_TEMPLATES.map((tmpl, idx) => {
                  const isSelected = selectedTemplate?.label === tmpl.label && selectedTemplate?.garmentType === tmpl.garmentType;
                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.templateCard, isSelected && { borderColor: accent }]}
                      onPress={() => selectTemplate(tmpl)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.templateIcon, { backgroundColor: accent + '22' }]}>
                        <Feather name="layers" size={ICON.md} color={accent} />
                      </View>
                      <Text style={styles.templateName}>{tmpl.label}</Text>
                      <Text style={styles.templateViews}>{tmpl.views.join(' · ')}</Text>
                      <View style={styles.badgeRow}>
                        {tmpl.hasPrintArea && (
                          <View style={[styles.badge, { backgroundColor: BLUE + '22' }]}>
                            <Text style={[styles.badgeText, { color: BLUE }]}>Print</Text>
                          </View>
                        )}
                        {tmpl.hasEmbroideryArea && (
                          <View style={[styles.badge, { backgroundColor: GOLD + '22' }]}>
                            <Text style={[styles.badgeText, { color: GOLD }]}>Embroidery</Text>
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.twoColGrid}>
                {CANVAS_PRESETS.map(preset => {
                  const isSelected = selectedPreset?.id === preset.id;
                  return (
                    <TouchableOpacity
                      key={preset.id}
                      style={[styles.templateCard, isSelected && { borderColor: accent }]}
                      onPress={() => selectPreset(preset)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.templateIcon, { backgroundColor: accent + '22' }]}>
                        <Feather name="crop" size={ICON.md} color={accent} />
                      </View>
                      <Text style={styles.templateName}>{preset.label}</Text>
                      <Text style={styles.templateViews}>{preset.width} × {preset.height}</Text>
                      {preset.ratio && (
                        <View style={[styles.badge, { backgroundColor: accent + '22' }]}>
                          <Text style={[styles.badgeText, { color: accent }]}>{preset.ratio}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
            <View style={styles.nextRow}>
              <PrimaryButton
                label="Next"
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep(3); }}
                disabled={!canProceedStep2}
                icon="arrow-right"
              />
            </View>
          </View>
        )}

        {/* ── Step 3: Dimensions ── */}
        {step === 3 && (
          <View>
            <StepHeader step={3} total={6} title="Dimensions" subtitle="Set the canvas size for your project." />
            {projectType === 'garment' && selectedTemplate ? (
              <BrandthreadCard style={styles.infoCard}>
                <View style={[styles.infoIconWrap, { backgroundColor: accent + '22' }]}>
                  <Feather name="layers" size={ICON.xl} color={accent} />
                </View>
                <Text style={styles.infoTitle}>{selectedTemplate.label}</Text>
                <Text style={styles.infoSub}>Views available</Text>
                <View style={styles.viewsRow}>
                  {selectedTemplate.views.map(v => (
                    <View key={v} style={[styles.viewChip, { borderColor: accent + '44' }]}>
                      <Text style={[styles.viewChipText, { color: accent }]}>{v.charAt(0).toUpperCase() + v.slice(1)}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.infoSub} >Canvas size: 1080 × 1080</Text>
              </BrandthreadCard>
            ) : (
              <View style={styles.dimSection}>
                <BrandthreadCard style={styles.dimCard}>
                  <View style={styles.dimRow}>
                    <View style={styles.dimField}>
                      <Text style={styles.dimLabel}>Width</Text>
                      <View style={styles.dimInputWrap}>
                        <TextInput
                          style={styles.dimInput}
                          value={String(canvasWidth)}
                          onChangeText={v => { const n = parseInt(v); if (!isNaN(n)) setCanvasWidth(n); }}
                          keyboardType="numeric"
                          placeholderTextColor={SUBTLE}
                          editable={useCustomDims}
                        />
                        <Text style={styles.dimUnit}>px</Text>
                      </View>
                    </View>
                    <Feather name="x" size={ICON.sm} color={SUBTLE} style={{ marginTop: 24 }} />
                    <View style={styles.dimField}>
                      <Text style={styles.dimLabel}>Height</Text>
                      <View style={styles.dimInputWrap}>
                        <TextInput
                          style={styles.dimInput}
                          value={String(canvasHeight)}
                          onChangeText={v => { const n = parseInt(v); if (!isNaN(n)) setCanvasHeight(n); }}
                          keyboardType="numeric"
                          placeholderTextColor={SUBTLE}
                          editable={useCustomDims}
                        />
                        <Text style={styles.dimUnit}>px</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.customToggle}
                    onPress={() => { setUseCustomDims(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <Feather
                      name={useCustomDims ? 'check-square' : 'square'}
                      size={ICON.sm}
                      color={useCustomDims ? accent : MUTED}
                    />
                    <Text style={[styles.customToggleText, useCustomDims && { color: accent }]}>Use custom dimensions</Text>
                  </TouchableOpacity>
                </BrandthreadCard>
              </View>
            )}
            <View style={styles.nextRow}>
              <PrimaryButton
                label="Next"
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep(4); }}
                icon="arrow-right"
              />
            </View>
          </View>
        )}

        {/* ── Step 4: Background ── */}
        {step === 4 && (
          <View>
            <StepHeader step={4} total={6} title="Background" subtitle="Choose a starting background color." />
            <View style={styles.bgOptions}>
              {BG_OPTIONS.map(opt => {
                const isSelected = bgMode === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.bgPill, isSelected && { borderColor: accent, backgroundColor: accent + '18' }]}
                    onPress={() => selectBg(opt.value)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.bgSwatch, {
                      backgroundColor: opt.value === 'transparent' ? 'transparent' : opt.value === 'custom' ? customHex : opt.value,
                      borderWidth: opt.value === 'transparent' || opt.value === '#FFFFFF' ? 1 : 0,
                      borderColor: BORDER,
                    }]} />
                    <Text style={[styles.bgPillLabel, isSelected && { color: accent }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {bgMode === 'custom' && (
              <BrandthreadCard style={styles.hexCard}>
                <Text style={styles.dimLabel}>Hex color</Text>
                <View style={styles.hexInputRow}>
                  <Text style={styles.hashSign}>#</Text>
                  <TextInput
                    style={styles.hexInput}
                    value={customHex.replace('#', '')}
                    onChangeText={v => {
                      const hex = '#' + v.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
                      setCustomHex(hex);
                      setBackgroundHex(hex);
                    }}
                    placeholder="1A1A2E"
                    placeholderTextColor={SUBTLE}
                    maxLength={6}
                    autoCapitalize="characters"
                  />
                  <View style={[styles.hexPreview, { backgroundColor: customHex }]} />
                </View>
              </BrandthreadCard>
            )}
            <View style={styles.nextRow}>
              <PrimaryButton
                label="Next"
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep(5); }}
                icon="arrow-right"
              />
            </View>
          </View>
        )}

        {/* ── Step 5: Name ── */}
        {step === 5 && (
          <View>
            <StepHeader step={5} total={6} title="Name your project" subtitle="Give it a name you'll recognize." />
            <BrandthreadCard style={styles.nameCard}>
              <Text style={styles.dimLabel}>Project name</Text>
              <TextInput
                style={styles.nameInput}
                value={projectName}
                onChangeText={setProjectName}
                placeholder={projectType ? PROJECT_TYPE_LABELS[projectType] : 'My Project'}
                placeholderTextColor={SUBTLE}
                autoFocus
                maxLength={80}
              />
            </BrandthreadCard>
            <View style={styles.nextRow}>
              <PrimaryButton
                label="Next"
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep(6); }}
                disabled={!projectName.trim()}
                icon="arrow-right"
              />
            </View>
          </View>
        )}

        {/* ── Step 6: Summary + Create ── */}
        {step === 6 && (
          <View>
            <StepHeader step={6} total={6} title="Ready to create" subtitle="Review your project settings before creating." />
            <BrandthreadCard style={styles.summaryCard} elevated>
              <View style={[styles.summaryIcon, { backgroundColor: accent + '22' }]}>
                <Feather name={PROJECT_TYPE_OPTIONS.find(o => o.type === projectType)?.icon as any ?? 'edit-2'} size={ICON.xl} color={accent} />
              </View>
              <Text style={styles.summaryName}>{finalName}</Text>

              <View style={styles.summaryRows}>
                <SummaryRow label="Type" value={projectType ? PROJECT_TYPE_LABELS[projectType] : '—'} />
                {projectType === 'garment' && selectedTemplate && (
                  <SummaryRow label="Template" value={selectedTemplate.label} />
                )}
                {projectType !== 'garment' && selectedPreset && (
                  <SummaryRow label="Canvas" value={selectedPreset.label} />
                )}
                <SummaryRow label="Dimensions" value={`${canvasWidth} × ${canvasHeight} px`} />
                <SummaryRow
                  label="Background"
                  value={backgroundHex === 'transparent' ? 'Transparent' : backgroundHex === '#FFFFFF' ? 'White' : backgroundHex === '#000000' ? 'Black' : backgroundHex}
                  swatch={backgroundHex !== 'transparent'}
                  swatchColor={backgroundHex}
                />
              </View>
            </BrandthreadCard>

            <View style={styles.createRow}>
              {isCreating ? (
                <View style={styles.creatingBox}>
                  <ActivityIndicator color={accent} size="large" />
                  <Text style={styles.creatingText}>Creating your project…</Text>
                </View>
              ) : (
                <PrimaryButton
                  label="Create project"
                  onPress={handleCreate}
                  icon="check"
                />
              )}
            </View>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </BrandthreadScreen>
  );
}

// ─── Summary Row ──────────────────────────────────────────────────────────────

function SummaryRow({ label, value, swatch, swatchColor }: { label: string; value: string; swatch?: boolean; swatchColor?: string }) {
  return (
    <View style={sr.row}>
      <Text style={sr.label}>{label}</Text>
      <View style={sr.right}>
        {swatch && swatchColor && (
          <View style={[sr.swatch, { backgroundColor: swatchColor, borderWidth: swatchColor === '#FFFFFF' ? 1 : 0, borderColor: BORDER }]} />
        )}
        <Text style={sr.value}>{value}</Text>
      </View>
    </View>
  );
}

const sr = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER_SUBTLE },
  label:  { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  right:  { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  swatch: { width: 16, height: 16, borderRadius: 4 },
  value:  { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
});

// ─── Main Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    gap: SP.sm,
  },
  typeCard: {
    width: '47%',
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    gap: SP.xs,
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.xs,
  },
  typeLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
  },
  typeDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
  },
  twoColGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    gap: SP.sm,
  },
  templateCard: {
    width: '47%',
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    gap: SP.xs,
  },
  templateIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.xs,
  },
  templateName: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
  },
  templateViews: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    textTransform: 'capitalize',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.xs,
  },
  badgeText: {
    fontFamily: FONT.medium,
    fontSize: 10,
  },
  nextRow: {
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
  },
  infoCard: {
    marginHorizontal: SP.lg,
    marginTop: SP.md,
    alignItems: 'center',
    paddingVertical: SP.xl,
    gap: SP.sm,
  },
  infoIconWrap: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.sm,
  },
  infoTitle: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: FG,
  },
  infoSub: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  viewsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
    justifyContent: 'center',
  },
  viewChip: {
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  viewChipText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
  },
  dimSection: {
    paddingHorizontal: SP.lg,
    paddingTop: SP.md,
  },
  dimCard: {
    gap: SP.md,
  },
  dimRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SP.sm,
  },
  dimField: {
    flex: 1,
    gap: 4,
  },
  dimLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: MUTED,
    marginBottom: 4,
  },
  dimInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.sm,
    height: 44,
    gap: 4,
  },
  dimInput: {
    flex: 1,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },
  dimUnit: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
  },
  customToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  customToggleText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  bgOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.lg,
    paddingTop: SP.md,
    gap: SP.sm,
  },
  bgPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  bgSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  bgPillLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  hexCard: {
    marginHorizontal: SP.lg,
    marginTop: SP.md,
  },
  hexInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.sm,
    height: 48,
    gap: 4,
  },
  hashSign: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: MUTED,
  },
  hexInput: {
    flex: 1,
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },
  hexPreview: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.xs,
    borderWidth: 1,
    borderColor: BORDER,
  },
  nameCard: {
    marginHorizontal: SP.lg,
    marginTop: SP.md,
    gap: SP.sm,
  },
  nameInput: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: SP.sm,
  },
  summaryCard: {
    marginHorizontal: SP.lg,
    marginTop: SP.md,
    alignItems: 'center',
    paddingBottom: SP.lg,
  },
  summaryIcon: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.md,
  },
  summaryName: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: FG,
    marginBottom: SP.md,
    textAlign: 'center',
  },
  summaryRows: {
    width: '100%',
  },
  createRow: {
    paddingHorizontal: SP.lg,
    paddingTop: SP.lg,
  },
  creatingBox: {
    alignItems: 'center',
    paddingVertical: SP.xl,
    gap: SP.md,
  },
  creatingText: {
    fontFamily: FONT.medium,
    fontSize: FS.base,
    color: MUTED,
  },
});

/**
 * AI helper — captions + hashtags, product descriptions from photos and size
 * charts. One screen, three modes:
 *   /ai-helper?mode=caption&postId=<uuid>            save to the seller's own post
 *   /ai-helper?mode=description&productId=&paths=    hand the text back to the product form
 *   /ai-helper?mode=size-chart&productId=<uuid>      save to the product's size chart
 * Results are only written when the seller taps the save button.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { setPendingAiDescription } from '@/lib/aiHelperHandoff';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

type Mode = 'caption' | 'description' | 'size-chart';
const TONES = ['casual', 'bold', 'luxury', 'playful', 'minimal', 'professional'] as const;
const GARMENTS = ['tee', 'hoodie', 'jacket', 'pants', 'shorts', 'dress'] as const;
const TOOL_BY_MODE: Record<Mode, string> = { caption: 'ai_caption', description: 'ai_product_description', 'size-chart': 'ai_size_chart' };
const TITLE: Record<Mode, string> = { caption: 'Caption', description: 'Product description', 'size-chart': 'Size chart' };

type StoredChart = { columns: string[]; rows: { size: string; values: string[] }[]; unit: 'inches' | 'cm'; notes?: string };
type Result =
  | { kind: 'caption'; captions: string[]; hashtags: string[] }
  | { kind: 'description'; title: string; description: string; bullets: string[] }
  | { kind: 'size-chart'; chart: StoredChart };

const DEMO: Record<Mode, Result> = {
  caption: { kind: 'caption', captions: ['Demo: fresh drop, same energy.', 'Demo: built for the block.', 'Demo: new fit, who dis.'], hashtags: ['#streetwear', '#newdrop', '#ootd'] },
  description: { kind: 'description', title: 'Demo boxy tee', description: 'Demo: a heavyweight black tee with a boxy cut and a small chest print.', bullets: ['Boxy cut', 'Black', 'Chest print'] },
  'size-chart': { kind: 'size-chart', chart: { columns: ['Chest', 'Length'], rows: [{ size: 'S', values: ['96', '68.5'] }, { size: 'M', values: ['100', '70'] }, { size: 'L', values: ['104', '71.5'] }], unit: 'cm', notes: 'Demo chart.' } },
};

function num(v: string): number | null {
  const n = Number(v.replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : null;
}

export default function AiHelperScreen() {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const api = useApi();
  const tabBar = useTabBarMetrics(2); // seller bar: Studio + AI side circles
  const { isSignedIn } = useAuth();
  const p = useLocalSearchParams<{ mode?: string; postId?: string; productId?: string; paths?: string; name?: string; draft?: string; demo?: string }>();
  const mode: Mode = p.mode === 'description' || p.mode === 'size-chart' ? p.mode : 'caption';
  const demo = isPreviewDemoMode() || p.demo === '1' && !isSignedIn;
  const signedOut = !isSignedIn && !demo;
  const paths = useMemo(() => (p.paths ? String(p.paths).split(',').filter(Boolean).slice(0, 4) : []), [p.paths]);

  const [tone, setTone] = useState<(typeof TONES)[number]>(mode === 'description' ? 'professional' : 'casual');
  const [text, setText] = useState(p.draft ? String(p.draft) : '');
  const [garment, setGarment] = useState<(typeof GARMENTS)[number]>('tee');
  const [unit, setUnit] = useState<'cm' | 'in'>('cm');
  const [base, setBase] = useState({ chest: '', waist: '', length: '' });
  const [grade, setGrade] = useState({ chest: '', waist: '', length: '' });
  const [cost, setCost] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ message: string; credits?: boolean } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [pick, setPick] = useState(0);

  useEffect(() => {
    if (signedOut || demo) return;
    let live = true;
    api.aiHelpers.credits().then((c) => {
      const t = c.tools.find((x) => x.tool === TOOL_BY_MODE[mode]);
      if (live && t) setCost(t.cost);
    }).catch(() => {});
    return () => { live = false; };
  }, [api, mode, signedOut, demo]);

  const explain = useCallback((e: unknown): { message: string; credits?: boolean } => {
    const err = e as { status?: number; code?: string; message?: string };
    if (err.status === 402) return { message: 'You are out of AI credits.', credits: true };
    if (err.status === 429) return { message: 'You have reached the AI limit for now.', credits: true };
    if (err.status === 503 && err.code === 'ai_unavailable') return { message: 'AI is not available right now.' };
    if (err.status === 503) return { message: 'AI credits are temporarily unavailable.', credits: true };
    if (err.status === 422 || err.status === 400 || err.status === 404) return { message: err.message || 'That could not be used.' };
    return { message: 'Something went wrong. Try again.' };
  }, []);

  async function generate() {
    setError(null); setSaved(false); setPick(0);
    if (demo) { setResult(DEMO[mode]); return; }
    let body: Record<string, unknown> | null = null;
    if (mode === 'size-chart') {
      const b: Record<string, number> = {}; const g: Record<string, number> = {};
      for (const k of ['chest', 'waist', 'length'] as const) {
        const bv = num(base[k]); const gv = num(grade[k]);
        if (base[k].trim() !== '' && bv === null) { setError({ message: `${k} must be a number` }); return; }
        if (grade[k].trim() !== '' && gv === null) { setError({ message: `${k} change must be a number` }); return; }
        if (bv !== null) { b[k] = bv; g[k] = gv ?? 0; }
      }
      if (Object.keys(b).length === 0) { setError({ message: 'Enter at least one base measurement' }); return; }
      body = { garmentType: garment, unit, base: b, grading: g };
    }
    if (mode === 'caption' && !text.trim() && paths.length === 0) { setError({ message: 'Write a few words about the post first' }); return; }
    setBusy(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (mode === 'caption') {
        const r = await api.aiHelpers.caption({ draft: text.trim() || undefined, imagePath: paths[0], tone });
        setResult({ kind: 'caption', ...r });
      } else if (mode === 'description') {
        const r = await api.aiHelpers.productDescription({
          ...(p.productId ? { productId: String(p.productId) } : { imagePaths: paths }),
          name: p.name ? String(p.name) : undefined, details: text.trim() || undefined, tone,
        });
        setResult({ kind: 'description', ...r });
      } else {
        const r = await api.aiHelpers.sizeChart(body);
        setResult({ kind: 'size-chart', chart: r.sizeChart });
      }
    } catch (e) { setError(explain(e)); } finally { setBusy(false); }
  }

  async function save(overwrite = false) {
    if (!result || demo) return;
    if (result.kind === 'description') {
      const text = `${result.description}\n\n${result.bullets.map((b) => `• ${b}`).join('\n')}`;
      setPendingAiDescription(text);
      goBackOr(router, '/add-product');
      return;
    }
    setSaving(true);
    try {
      if (result.kind === 'caption') {
        await api.aiHelpers.save({ target: 'post', postId: p.postId, caption: result.captions[pick], hashtags: result.hashtags, overwrite });
      } else {
        await api.aiHelpers.save({ target: 'product', productId: p.productId, field: 'sizeChart', sizeChart: result.chart, overwrite });
      }
      setSaved(true); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const err = e as { status?: number; code?: string };
      if (err.status === 409 && err.code === 'would_overwrite') {
        const what = result.kind === 'caption' ? 'caption' : 'size chart';
        Alert.alert(`Replace the current ${what}?`, 'Your existing one will be overwritten.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: () => void save(true) },
        ]);
      } else setError(explain(e));
    } finally { setSaving(false); }
  }

  const canSave = result && !saved && !demo && (
    result.kind === 'description' || (result.kind === 'caption' && p.postId) || (result.kind === 'size-chart' && p.productId));
  const saveLabel = result?.kind === 'description' ? 'Use in product' : result?.kind === 'caption' ? 'Save to post' : 'Save to product';
  const genLabel = `Generate${cost ? ` · ${cost} credit${cost === 1 ? '' : 's'}` : ''}`;

  const chips = (items: readonly string[], value: string, set: (v: any) => void) => (
    <View style={s.chipRow}>
      {items.map((t) => (
        <TouchableOpacity key={t} onPress={() => set(t)} style={[s.chip, value === t && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: value === t }}>
          <Text style={[s.chipText, value === t && s.chipTextOn]}>{t.length > 2 ? t.charAt(0).toUpperCase() + t.slice(1) : t}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const field = (label: string, value: string, set: (v: string) => void) => (
    <View style={s.numCell}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.numInput} value={value} onChangeText={set} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedForeground} maxLength={6} />
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <ScreenHeader title={TITLE[mode]} />
      {signedOut ? (
        <View style={s.center}><Text style={s.body}>Sign in to use AI helpers.</Text></View>
      ) : (
        <>
          <ScrollView style={s.flex} contentContainerStyle={[s.scroll, { paddingBottom: SP.lg }]} keyboardShouldPersistTaps="handled">
            {demo && <Text style={s.demo}>Demo output</Text>}
            {mode !== 'size-chart' && (
              <>
                <Text style={s.label}>{mode === 'caption' ? 'What is the post about?' : 'Anything to mention?'}</Text>
                <TextInput style={s.area} value={text} onChangeText={setText} multiline maxLength={mode === 'caption' ? 1000 : 500}
                  placeholder={mode === 'caption' ? 'New hoodie drop, limited run...' : 'Fit, fabric, care...'} placeholderTextColor={colors.mutedForeground} />
                <Text style={s.label}>Tone</Text>
                {chips(TONES, tone, setTone)}
              </>
            )}
            {mode === 'size-chart' && (
              <>
                <Text style={s.label}>Garment</Text>
                {chips(GARMENTS, garment, setGarment)}
                <Text style={s.label}>Unit</Text>
                {chips(['cm', 'in'], unit, setUnit)}
                <Text style={s.label}>Size M measurements</Text>
                <View style={s.numRow}>{field('Chest', base.chest, (v) => setBase({ ...base, chest: v }))}{field('Waist', base.waist, (v) => setBase({ ...base, waist: v }))}{field('Length', base.length, (v) => setBase({ ...base, length: v }))}</View>
                <Text style={s.label}>Change per size step</Text>
                <View style={s.numRow}>{field('Chest', grade.chest, (v) => setGrade({ ...grade, chest: v }))}{field('Waist', grade.waist, (v) => setGrade({ ...grade, waist: v }))}{field('Length', grade.length, (v) => setGrade({ ...grade, length: v }))}</View>
              </>
            )}

            {error && (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{error.message}</Text>
                {error.credits && (
                  <TouchableOpacity onPress={() => router.push('/ai-credits' as never)} accessibilityRole="button"><Text style={s.link}>Get credits</Text></TouchableOpacity>
                )}
              </View>
            )}

            {result?.kind === 'caption' && (
              <View style={s.results}>
                {result.captions.map((c, i) => (
                  <TouchableOpacity key={i} onPress={() => setPick(i)} style={[s.card, pick === i && s.cardOn]} accessibilityRole="radio" accessibilityState={{ selected: pick === i }}>
                    <Text style={s.cardText}>{c}</Text>
                    <Feather name={pick === i ? 'check-circle' : 'circle'} size={20} color={colors.foreground} />
                  </TouchableOpacity>
                ))}
                <View style={s.tags}>{result.hashtags.map((h) => <Text key={h} style={s.tag}>{h}</Text>)}</View>
              </View>
            )}
            {result?.kind === 'description' && (
              <View style={s.results}>
                <View style={s.cardStatic}>
                  <Text style={s.cardTitle}>{result.title}</Text>
                  <Text style={s.cardText}>{result.description}</Text>
                  {result.bullets.map((b) => <Text key={b} style={s.cardText}>{`•  ${b}`}</Text>)}
                </View>
              </View>
            )}
            {result?.kind === 'size-chart' && (
              <View style={s.results}>
                <View style={s.cardStatic}>
                  <View style={s.tRow}>
                    <Text style={[s.tCell, s.tHead]}>Size</Text>
                    {result.chart.columns.map((c) => <Text key={c} style={[s.tCell, s.tHead]}>{c}</Text>)}
                  </View>
                  {result.chart.rows.map((r) => (
                    <View key={r.size} style={s.tRow}>
                      <Text style={[s.tCell, s.tBold]}>{r.size}</Text>
                      {r.values.map((v, i) => <Text key={i} style={s.tCell}>{v}</Text>)}
                    </View>
                  ))}
                  <Text style={s.meta}>{result.chart.unit === 'inches' ? 'Inches' : 'Centimetres'}{result.chart.notes ? `  ·  ${result.chart.notes}` : ''}</Text>
                </View>
              </View>
            )}
            {saved && <Text style={s.body}>Saved.</Text>}
          </ScrollView>

          <View style={[s.footer, { marginBottom: tabBar.occupiedHeight, paddingBottom: SP.md, backgroundColor: colors.background, borderTopColor: colors.border }]}>
            {result && canSave ? (
              <View style={s.footerRow}>
                <TouchableOpacity style={[s.btnGhost]} onPress={generate} disabled={busy} accessibilityRole="button"><Text style={s.btnGhostText}>Regenerate</Text></TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.flex]} onPress={() => save()} disabled={saving} accessibilityRole="button">
                  {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={s.btnText}>{saveLabel}</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={s.btn} onPress={generate} disabled={busy} accessibilityRole="button">
                {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={s.btnText}>{result ? 'Regenerate' : genLabel}</Text>}
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
    scroll: { paddingHorizontal: SP.md, paddingTop: SP.md },
    flex: { flex: 1 },
    label: { fontFamily: FONT.semibold, fontSize: FS.sm, color: c.mutedForeground, marginTop: SP.md, marginBottom: SP.sm },
    body: { fontFamily: FONT.regular, fontSize: FS.base, color: c.foreground, marginTop: SP.md, textAlign: 'center' },
    demo: { fontFamily: FONT.semibold, fontSize: FS.meta, color: c.mutedForeground },
    area: { minHeight: 120, textAlignVertical: 'top', padding: SP.md, borderRadius: RADIUS.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, color: c.foreground, fontFamily: FONT.regular, fontSize: FS.base },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
    chip: { paddingHorizontal: SP.md, height: 40, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    chipOn: { backgroundColor: c.foreground, borderColor: c.foreground },
    chipText: { fontFamily: FONT.medium, fontSize: FS.sm, color: c.foreground, },
    chipTextOn: { color: c.background },
    numRow: { flexDirection: 'row', gap: SP.sm },
    numCell: { flex: 1 },
    numInput: { height: 48, borderRadius: RADIUS.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, color: c.foreground, paddingHorizontal: SP.md, fontFamily: FONT.medium, fontSize: FS.base },
    results: { marginTop: SP.lg, gap: SP.sm },
    card: { flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.md, borderRadius: RADIUS.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    cardOn: { borderColor: c.foreground },
    cardStatic: { gap: SP.sm, padding: SP.md, borderRadius: RADIUS.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    cardTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: c.foreground },
    cardText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: c.foreground, lineHeight: 22 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm },
    tag: { fontFamily: FONT.medium, fontSize: FS.sm, color: c.mutedForeground },
    tRow: { flexDirection: 'row', paddingVertical: 6 },
    tCell: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: c.foreground },
    tHead: { fontFamily: FONT.semibold, color: c.mutedForeground, fontSize: FS.sm },
    tBold: { fontFamily: FONT.bold },
    meta: { fontFamily: FONT.regular, fontSize: FS.meta, color: c.mutedForeground, marginTop: SP.sm },
    errorBox: { marginTop: SP.md, gap: SP.sm },
    errorText: { fontFamily: FONT.medium, fontSize: FS.sm, color: c.foreground },
    link: { fontFamily: FONT.semibold, fontSize: FS.sm, color: c.foreground, textDecorationLine: 'underline' },
    footer: { paddingHorizontal: SP.md, paddingTop: SP.md, borderTopWidth: StyleSheet.hairlineWidth },
    footerRow: { flexDirection: 'row', gap: SP.sm },
    btn: { height: 52, borderRadius: RADIUS.pill, backgroundColor: c.foreground, alignItems: 'center', justifyContent: 'center' },
    btnText: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.background },
    btnGhost: { height: 52, paddingHorizontal: SP.lg, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    btnGhostText: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
  });
}

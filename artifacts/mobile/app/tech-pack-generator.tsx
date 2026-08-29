import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useApi } from '@/hooks/useApi';
import { getEntitlementRejection } from '@/lib/entitlementError';

interface Photo {
  id: string;
  uri: string;
  base64: string;
  mime: string;
}

interface SizeRow {
  point: string;
  values: Record<string, string>;
}

const MAX_PHOTOS = 6;
const DEFAULT_SIZES = ['S', 'M', 'L'];
const DEFAULT_POINTS = ['Chest', 'Length', 'Sleeve'];

type Step = 'info' | 'photos' | 'sizing' | 'details' | 'result';
const STEPS: Step[] = ['info', 'photos', 'sizing', 'details', 'result'];

export default function TechPackGeneratorScreen() {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const [step, setStep] = useState<Step>('info');

  // Step 1: product info
  const [productName, setProductName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [category, setCategory] = useState('');
  const [season, setSeason] = useState('');
  const [styleNumber, setStyleNumber] = useState('');
  const [description, setDescription] = useState('');
  const [colorwaysText, setColorwaysText] = useState('');

  // Step 2: photos
  const [photos, setPhotos] = useState<Photo[]>([]);

  // Step 3: size chart
  const [sizes, setSizes] = useState<string[]>(DEFAULT_SIZES);
  const [rows, setRows] = useState<SizeRow[]>(
    DEFAULT_POINTS.map((point) => ({ point, values: {} }))
  );

  // Step 4: details
  const [materialsNotes, setMaterialsNotes] = useState('');
  const [printPlacementNotes, setPrintPlacementNotes] = useState('');
  const [careNotes, setCareNotes] = useState('');

  // Step 5: result
  const [loading, setLoading] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState('tech-pack.pdf');

  const stepIndex = STEPS.indexOf(step);

  function goNext() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }
  function goBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  async function pickPhotos() {
    if (photos.length >= MAX_PHOTOS) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to upload photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const picked: Photo[] = result.assets
      .filter((a) => !!a.base64)
      .slice(0, MAX_PHOTOS - photos.length)
      .map((a) => ({
        id: `${Date.now()}-${a.assetId ?? a.uri}`,
        uri: a.uri,
        base64: a.base64 as string,
        mime: a.mimeType ?? 'image/jpeg',
      }));
    setPhotos((prev) => [...prev, ...picked]);
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  function addSize() {
    const label = `Size ${sizes.length + 1}`;
    setSizes((prev) => [...prev, label]);
  }
  function removeSize(size: string) {
    setSizes((prev) => prev.filter((s) => s !== size));
    setRows((prev) =>
      prev.map((r) => {
        const { [size]: _removed, ...rest } = r.values;
        return { ...r, values: rest };
      })
    );
  }
  function renameSize(oldName: string, newName: string) {
    setSizes((prev) => prev.map((s) => (s === oldName ? newName : s)));
    setRows((prev) =>
      prev.map((r) => {
        const values = { ...r.values };
        if (oldName in values) {
          values[newName] = values[oldName];
          delete values[oldName];
        }
        return { ...r, values };
      })
    );
  }
  function addRow() {
    setRows((prev) => [...prev, { point: '', values: {} }]);
  }
  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }
  function updateRowPoint(index: number, point: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, point } : r)));
  }
  function updateCell(index: number, size: string, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, values: { ...r.values, [size]: value } } : r))
    );
  }

  async function generate() {
    if (loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setPdfBase64(null);
    setStep('result');
    try {
      const colorways = colorwaysText
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const photoUrls = photos.map((p) => `data:${p.mime};base64,${p.base64}`);
      const result = await api.techpack.generate({
        productName: productName.trim(),
        brandName: brandName.trim(),
        category: category.trim(),
        season: season.trim(),
        styleNumber: styleNumber.trim(),
        description: description.trim(),
        colorways,
        materialsNotes: materialsNotes.trim(),
        printPlacementNotes: printPlacementNotes.trim(),
        careNotes: careNotes.trim(),
        sizeChart: { sizes, rows: rows.filter((r) => r.point.trim().length > 0) },
        photos: photoUrls,
      });
      if (result?.pdf_base64) {
        setPdfBase64(result.pdf_base64);
        setPdfFilename(result.filename || 'tech-pack.pdf');
      } else {
        Alert.alert('Generation failed', 'Could not generate the tech pack. Please try again.');
      }
    } catch (error) {
      const rejection = getEntitlementRejection(error);
      if (rejection) {
        Alert.alert(
          `Upgrade to ${rejection.requiredPlan === 'growth' ? 'Growth' : 'Scale'}`,
          rejection.message,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'View plans', onPress: () => router.push('/subscription' as never) },
          ],
        );
        setStep('details');
        return;
      }
      Alert.alert('Something went wrong', 'Could not generate the tech pack. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function shareTechPack() {
    if (!pdfBase64) return;
    try {
      const file = new File(Paths.cache, pdfFilename);
      file.write(pdfBase64, { encoding: 'base64' });
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing unavailable', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Send tech pack to manufacturer' });
    } catch {
      Alert.alert('Share failed', 'Could not share the tech pack. Please try again.');
    }
  }

  function startOver() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep('info');
    setProductName('');
    setBrandName('');
    setCategory('');
    setSeason('');
    setStyleNumber('');
    setDescription('');
    setColorwaysText('');
    setPhotos([]);
    setSizes(DEFAULT_SIZES);
    setRows(DEFAULT_POINTS.map((point) => ({ point, values: {} })));
    setMaterialsNotes('');
    setPrintPlacementNotes('');
    setCareNotes('');
    setPdfBase64(null);
  }

  const canGoNextFromInfo = productName.trim().length > 0;
  const canGoNextFromPhotos = photos.length > 0;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenHeader title="Tech Pack Generator" subtitle="Professional tech packs for manufacturers" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.stepRow}>
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <View
                style={[
                  styles.stepDot,
                  { backgroundColor: i <= stepIndex ? colors.primary : colors.secondary },
                ]}
              />
              {i < STEPS.length - 1 && <View style={[styles.stepLine, { backgroundColor: colors.border }]} />}
            </React.Fragment>
          ))}
        </View>

        {step === 'info' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Step 1 · Product info</Text>
            <Field label="Product name*" value={productName} onChangeText={setProductName} colors={colors} placeholder="Oversized Hoodie" />
            <Field label="Brand name" value={brandName} onChangeText={setBrandName} colors={colors} placeholder="Your brand" />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field label="Category" value={category} onChangeText={setCategory} colors={colors} placeholder="Hoodie" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Season" value={season} onChangeText={setSeason} colors={colors} placeholder="FW26" />
              </View>
            </View>
            <Field label="Style #" value={styleNumber} onChangeText={setStyleNumber} colors={colors} placeholder="HD-001" />
            <Field
              label="Description / notes"
              value={description}
              onChangeText={setDescription}
              colors={colors}
              placeholder="Heavyweight cotton fleece, boxy fit, dropped shoulder..."
              multiline
            />
            <Field
              label="Colorways (comma separated)"
              value={colorwaysText}
              onChangeText={setColorwaysText}
              colors={colors}
              placeholder="Black, Sand, Forest Green"
            />

            <TouchableOpacity
              onPress={goNext}
              activeOpacity={0.85}
              disabled={!canGoNextFromInfo}
              style={[styles.primaryBtn, { backgroundColor: canGoNextFromInfo ? colors.primary : colors.secondary, marginTop: 20 }]}
            >
              <Text style={[styles.primaryBtnText, { color: canGoNextFromInfo ? colors.primaryForeground : colors.mutedForeground }]}>
                Next: add photos
              </Text>
              <Feather name="arrow-right" size={16} color={canGoNextFromInfo ? colors.primaryForeground : colors.mutedForeground} />
            </TouchableOpacity>
          </>
        )}

        {step === 'photos' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Step 2 · Photos & mockups</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
              Upload flat-lay photos, mockups, or design files from your camera roll — up to {MAX_PHOTOS}.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trayRow}>
              {photos.map((p) => (
                <View key={p.id} style={styles.trayThumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.trayThumb} resizeMode="cover" />
                  <TouchableOpacity
                    style={[styles.trayRemove, { backgroundColor: colors.destructive }]}
                    onPress={() => removePhoto(p.id)}
                    activeOpacity={0.8}
                  >
                    <Feather name="x" size={11} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <TouchableOpacity
                  onPress={pickPhotos}
                  activeOpacity={0.8}
                  style={[styles.addTile, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Feather name="plus" size={20} color={colors.primary} />
                </TouchableOpacity>
              )}
            </ScrollView>

            <View style={styles.navRow}>
              <TouchableOpacity onPress={goBack} activeOpacity={0.7} style={styles.secondaryBtn}>
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={goNext}
                activeOpacity={0.85}
                disabled={!canGoNextFromPhotos}
                style={[styles.primaryBtn, { flex: 1, backgroundColor: canGoNextFromPhotos ? colors.primary : colors.secondary }]}
              >
                <Text style={[styles.primaryBtnText, { color: canGoNextFromPhotos ? colors.primaryForeground : colors.mutedForeground }]}>
                  Next: size chart
                </Text>
                <Feather name="arrow-right" size={16} color={canGoNextFromPhotos ? colors.primaryForeground : colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </>
        )}

        {step === 'sizing' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Step 3 · Size chart</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
              Optional — add measurement points and values per size (inches).
            </Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={styles.tableHeaderRow}>
                  <View style={[styles.tableCell, styles.tableFirstCol]} />
                  {sizes.map((size) => (
                    <View key={size} style={styles.tableCell}>
                      <TextInput
                        value={size}
                        onChangeText={(v) => renameSize(size, v)}
                        style={[styles.sizeInput, { color: colors.foreground, borderColor: colors.border }]}
                      />
                      <TouchableOpacity onPress={() => removeSize(size)} style={{ marginLeft: 4 }}>
                        <Feather name="x" size={12} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity onPress={addSize} style={[styles.tableCell, styles.addColBtn, { borderColor: colors.border }]}>
                    <Feather name="plus" size={14} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                {rows.map((row, i) => (
                  <View key={i} style={styles.tableRow}>
                    <View style={[styles.tableCell, styles.tableFirstCol]}>
                      <TextInput
                        value={row.point}
                        onChangeText={(v) => updateRowPoint(i, v)}
                        placeholder="Chest"
                        placeholderTextColor={colors.mutedForeground}
                        style={[styles.pointInput, { color: colors.foreground, borderColor: colors.border }]}
                      />
                    </View>
                    {sizes.map((size) => (
                      <View key={size} style={styles.tableCell}>
                        <TextInput
                          value={row.values[size] ?? ''}
                          onChangeText={(v) => updateCell(i, size, v)}
                          placeholder="—"
                          placeholderTextColor={colors.mutedForeground}
                          style={[styles.valueInput, { color: colors.foreground, borderColor: colors.border }]}
                        />
                      </View>
                    ))}
                    <TouchableOpacity onPress={() => removeRow(i)} style={[styles.tableCell, styles.addColBtn]}>
                      <Feather name="trash-2" size={13} color={colors.destructive} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity onPress={addRow} activeOpacity={0.8} style={[styles.addRowBtn, { borderColor: colors.border }]}>
              <Feather name="plus" size={14} color={colors.primary} />
              <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 12 }}>Add measurement point</Text>
            </TouchableOpacity>

            <View style={styles.navRow}>
              <TouchableOpacity onPress={goBack} activeOpacity={0.7} style={styles.secondaryBtn}>
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goNext} activeOpacity={0.85} style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.primary }]}>
                <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Next: details</Text>
                <Feather name="arrow-right" size={16} color={colors.primaryForeground} />
              </TouchableOpacity>
            </View>
          </>
        )}

        {step === 'details' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Step 4 · Materials & finishing</Text>
            <Field
              label="Materials & trims"
              value={materialsNotes}
              onChangeText={setMaterialsNotes}
              colors={colors}
              placeholder="400gsm cotton fleece, YKK zippers, woven label at neck..."
              multiline
            />
            <Field
              label="Print / embroidery placement"
              value={printPlacementNotes}
              onChangeText={setPrintPlacementNotes}
              colors={colors}
              placeholder="Embroidered logo, left chest, 3in wide..."
              multiline
            />
            <Field
              label="Care instructions"
              value={careNotes}
              onChangeText={setCareNotes}
              colors={colors}
              placeholder="Leave blank to auto-generate from fabric type"
              multiline
            />

            <TouchableOpacity onPress={generate} activeOpacity={0.85} style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 20 }]}>
              <Feather name="file-text" size={16} color={colors.primaryForeground} />
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Generate tech pack</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goBack} activeOpacity={0.7} style={styles.secondaryBtn}>
              <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'result' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {loading ? 'Building your tech pack…' : pdfBase64 ? 'Your tech pack is ready' : 'Something went wrong'}
            </Text>
            <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {loading ? (
                <View style={styles.loadingDots}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[styles.loadDot, { backgroundColor: colors.primary }]} />
                  ))}
                </View>
              ) : pdfBase64 ? (
                <>
                  <Feather name="file-text" size={36} color={colors.primary} />
                  <Text style={[styles.resultFilename, { color: colors.foreground }]}>{pdfFilename}</Text>
                  <Text style={[styles.resultSubtitle, { color: colors.mutedForeground }]}>
                    Full spec sheet with photos, materials, size chart, and care instructions.
                  </Text>
                </>
              ) : (
                <Feather name="alert-circle" size={28} color={colors.mutedForeground} />
              )}
            </View>

            {!loading && (
              <View style={{ gap: 12, marginTop: 20 }}>
                {pdfBase64 && (
                  <TouchableOpacity onPress={shareTechPack} activeOpacity={0.85} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
                    <Feather name="share" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Send to manufacturer</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={startOver} activeOpacity={0.7} style={styles.secondaryBtn}>
                  <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Start a new tech pack</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  colors,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: ReturnType<typeof useColors>;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        maxLength={1000}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepLine: { flex: 1, height: 1, marginHorizontal: 6 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 14, lineHeight: 17 },
  row2: { flexDirection: 'row', gap: 12 },
  inputLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },
  input: { borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 15,
  },
  primaryBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  secondaryBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  secondaryBtnText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  trayRow: { gap: 10, paddingVertical: 4 },
  trayThumbWrap: { position: 'relative' },
  trayThumb: { width: 72, height: 72, borderRadius: 12 },
  trayRemove: {
    position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  addTile: {
    width: 72, height: 72, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  tableHeaderRow: { flexDirection: 'row' },
  tableRow: { flexDirection: 'row' },
  tableCell: { width: 84, paddingVertical: 4, paddingRight: 6, flexDirection: 'row', alignItems: 'center' },
  tableFirstCol: { width: 110 },
  addColBtn: { width: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8, borderStyle: 'dashed' },
  sizeInput: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, fontSize: 12, fontFamily: 'Inter_600SemiBold', flex: 1 },
  pointInput: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, fontSize: 12, fontFamily: 'Inter_400Regular', width: '100%' },
  valueInput: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, fontSize: 12, fontFamily: 'Inter_400Regular', width: '100%' },
  addRowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginTop: 12,
  },
  resultCard: {
    borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 40, paddingHorizontal: 20, gap: 8,
  },
  resultFilename: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  resultSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 8, height: 8, borderRadius: 4, opacity: 0.6 },
});

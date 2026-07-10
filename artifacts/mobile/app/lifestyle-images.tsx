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
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useApi } from '@/hooks/useApi';

interface Photo {
  id: string;
  uri: string;
  base64: string;
  mime: string;
}

const MAX_PHOTOS = 4;

type Step = 'reference' | 'product' | 'result';

export default function LifestyleImagesScreen() {
  const colors = useColors();
  const api = useApi();
  const [step, setStep] = useState<Step>('reference');
  const [referencePhotos, setReferencePhotos] = useState<Photo[]>([]);
  const [productPhotos, setProductPhotos] = useState<Photo[]>([]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultB64, setResultB64] = useState<string | null>(null);

  async function pickPhotos(group: 'reference' | 'product') {
    const current = group === 'reference' ? referencePhotos : productPhotos;
    if (current.length >= MAX_PHOTOS) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to upload photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - current.length,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const picked: Photo[] = result.assets
      .filter((a) => !!a.base64)
      .slice(0, MAX_PHOTOS - current.length)
      .map((a) => ({
        id: `${Date.now()}-${a.assetId ?? a.uri}`,
        uri: a.uri,
        base64: a.base64 as string,
        mime: a.mimeType ?? 'image/jpeg',
      }));
    if (group === 'reference') {
      setReferencePhotos((prev) => [...prev, ...picked]);
    } else {
      setProductPhotos((prev) => [...prev, ...picked]);
    }
  }

  function removePhoto(group: 'reference' | 'product', id: string) {
    if (group === 'reference') {
      setReferencePhotos((prev) => prev.filter((p) => p.id !== id));
    } else {
      setProductPhotos((prev) => prev.filter((p) => p.id !== id));
    }
  }

  function goToProductStep() {
    if (referencePhotos.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep('product');
  }

  async function generate() {
    if (productPhotos.length === 0 || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setResultB64(null);
    setStep('result');
    try {
      const refUrls = referencePhotos.map((p) => `data:${p.mime};base64,${p.base64}`);
      const productUrls = productPhotos.map((p) => `data:${p.mime};base64,${p.base64}`);
      const result = await api.lifestyle.generate(refUrls, productUrls, description.trim());
      if (result?.b64_json) {
        setResultB64(result.b64_json);
      } else {
        Alert.alert('Generation failed', 'Could not generate the lifestyle photo. Please try again.');
      }
    } catch {
      Alert.alert('Something went wrong', 'Could not generate the lifestyle photo. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep('reference');
    setReferencePhotos([]);
    setProductPhotos([]);
    setDescription('');
    setResultB64(null);
  }

  function renderTray(group: 'reference' | 'product', photos: Photo[]) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trayRow}>
        {photos.map((p) => (
          <View key={p.id} style={styles.trayThumbWrap}>
            <Image source={{ uri: p.uri }} style={styles.trayThumb} resizeMode="cover" />
            <TouchableOpacity
              style={[styles.trayRemove, { backgroundColor: colors.destructive }]}
              onPress={() => removePhoto(group, p.id)}
              activeOpacity={0.8}
            >
              <Feather name="x" size={11} color="#FFF" />
            </TouchableOpacity>
          </View>
        ))}
        {photos.length < MAX_PHOTOS && (
          <TouchableOpacity
            onPress={() => pickPhotos(group)}
            activeOpacity={0.8}
            style={[styles.addTile, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="plus" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenHeader title="Lifestyle Images" subtitle="Contextual lifestyle shots for any product" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Step indicator */}
        <View style={styles.stepRow}>
          {(['reference', 'product', 'result'] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <View style={[styles.stepDot, {
                backgroundColor: step === s ? colors.primary : (
                  (s === 'reference' && step !== 'reference') || (s === 'product' && step === 'result')
                    ? colors.primary
                    : colors.secondary
                ),
              }]} />
              {i < 2 && <View style={[styles.stepLine, { backgroundColor: colors.border }]} />}
            </React.Fragment>
          ))}
        </View>

        {step === 'reference' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Step 1 · Reference photos</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
              Upload photos of the lifestyle scene, mood, and style you want to match — up to {MAX_PHOTOS}.
            </Text>
            {referencePhotos.length === 0 ? (
              <TouchableOpacity
                onPress={() => pickPhotos('reference')}
                activeOpacity={0.8}
                style={[styles.dropzone, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Feather name="image" size={26} color={colors.primary} />
                <Text style={[styles.dropzoneTitle, { color: colors.foreground }]}>Add reference photos</Text>
              </TouchableOpacity>
            ) : (
              renderTray('reference', referencePhotos)
            )}

            <TouchableOpacity
              onPress={goToProductStep}
              activeOpacity={0.85}
              disabled={referencePhotos.length === 0}
              style={[styles.primaryBtn, { backgroundColor: referencePhotos.length > 0 ? colors.primary : colors.secondary, marginTop: 24 }]}
            >
              <Text style={[styles.primaryBtnText, { color: referencePhotos.length > 0 ? colors.primaryForeground : colors.mutedForeground }]}>
                Next: add your product
              </Text>
              <Feather name="arrow-right" size={16} color={referencePhotos.length > 0 ? colors.primaryForeground : colors.mutedForeground} />
            </TouchableOpacity>
          </>
        )}

        {step === 'product' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Step 2 · Your product or mockup</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
              Upload photos of your clothing product or design mockup — up to {MAX_PHOTOS}.
            </Text>
            {productPhotos.length === 0 ? (
              <TouchableOpacity
                onPress={() => pickPhotos('product')}
                activeOpacity={0.8}
                style={[styles.dropzone, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Feather name="shopping-bag" size={26} color={colors.primary} />
                <Text style={[styles.dropzoneTitle, { color: colors.foreground }]}>Add product photos</Text>
              </TouchableOpacity>
            ) : (
              renderTray('product', productPhotos)
            )}

            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Describe the shot (optional)</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
              placeholder="e.g. golden hour on a city rooftop, candid pose"
              placeholderTextColor={colors.mutedForeground}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
            />

            <TouchableOpacity
              onPress={generate}
              activeOpacity={0.85}
              disabled={productPhotos.length === 0}
              style={[styles.primaryBtn, { backgroundColor: productPhotos.length > 0 ? colors.primary : colors.secondary, marginTop: 20 }]}
            >
              <Feather name="zap" size={16} color={productPhotos.length > 0 ? colors.primaryForeground : colors.mutedForeground} />
              <Text style={[styles.primaryBtnText, { color: productPhotos.length > 0 ? colors.primaryForeground : colors.mutedForeground }]}>
                Generate lifestyle photo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep('reference')} activeOpacity={0.7} style={styles.secondaryBtn}>
              <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Back to reference photos</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 'result' && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {loading ? 'Generating your lifestyle photo…' : resultB64 ? 'Your lifestyle photo' : 'Something went wrong'}
            </Text>
            <View style={[styles.resultFrame, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {loading ? (
                <View style={styles.loadingDots}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[styles.loadDot, { backgroundColor: colors.primary }]} />
                  ))}
                </View>
              ) : resultB64 ? (
                <Image
                  source={{ uri: `data:image/png;base64,${resultB64}` }}
                  style={styles.resultImage}
                  resizeMode="cover"
                />
              ) : (
                <Feather name="alert-circle" size={28} color={colors.mutedForeground} />
              )}
            </View>

            {!loading && (
              <View style={{ gap: 12, marginTop: 20 }}>
                {resultB64 && (
                  <TouchableOpacity onPress={generate} activeOpacity={0.85} style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
                    <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Regenerate</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={startOver} activeOpacity={0.7} style={styles.secondaryBtn}>
                  <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Start over</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  stepDot: { width: 10, height: 10, borderRadius: 5 },
  stepLine: { flex: 1, height: 1, marginHorizontal: 8 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  sectionSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 14, lineHeight: 17 },
  dropzone: {
    borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center',
    justifyContent: 'center', paddingVertical: 40, gap: 10,
  },
  dropzoneTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
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
  inputLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 20, marginBottom: 8 },
  input: {
    borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular',
    minHeight: 72, textAlignVertical: 'top',
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 15,
  },
  primaryBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  secondaryBtn: { alignItems: 'center', paddingVertical: 10 },
  secondaryBtnText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  resultFrame: {
    aspectRatio: 1, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  resultImage: { width: '100%', height: '100%' },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 8, height: 8, borderRadius: 4, opacity: 0.6 },
});

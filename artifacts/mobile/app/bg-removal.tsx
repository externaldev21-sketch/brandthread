import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Image,
  Alert,
  ScrollView,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import { useApi } from '@/hooks/useApi';

type SourcePhoto = { uri: string; base64: string; mime: string };

export default function BackgroundRemovalScreen() {
  const colors = useColors();
  const api = useApi();
  const [source, setSource] = useState<SourcePhoto | null>(null);
  const [resultB64, setResultB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo library access to choose an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const asset = result.assets[0];
    setSource({ uri: asset.uri, base64: asset.base64 as string, mime: asset.mimeType ?? 'image/jpeg' });
    setResultB64(null);
  }

  async function removeBackground() {
    if (!source || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setResultB64(null);
    try {
      const dataUrl = `data:${source.mime};base64,${source.base64}`;
      const result = await api.bgRemoval.remove(dataUrl);
      if (result?.b64_json) {
        setResultB64(result.b64_json);
      } else {
        Alert.alert('Removal failed', 'Could not remove the background. Please try a different image.');
      }
    } catch {
      Alert.alert('Something went wrong', 'Could not remove the background. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function saveToCameraRoll() {
    if (!resultB64 || saving) return;
    setSaving(true);
    try {
      const MediaLibrary = await import('expo-media-library');
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access to save your image.');
        return;
      }
      const file = new File(Paths.cache, `cutout-${Date.now()}.png`);
      file.write(resultB64, { encoding: 'base64' });
      await MediaLibrary.saveToLibraryAsync(file.uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Your transparent cutout was saved to your camera roll in full quality.');
    } catch {
      Alert.alert('Save failed', 'Could not save the image. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function startOver() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSource(null);
    setResultB64(null);
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Background Removal" subtitle="Clean product cutouts in seconds" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {!source && (
          <TouchableOpacity
            onPress={pickImage}
            activeOpacity={0.8}
            style={[styles.dropzone, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Feather name="upload" size={28} color={colors.primary} />
            <Text style={[styles.dropzoneTitle, { color: colors.foreground }]}>Choose a photo</Text>
            <Text style={[styles.dropzoneSubtitle, { color: colors.mutedForeground }]}>
              Pick an image from your camera roll to remove its background
            </Text>
          </TouchableOpacity>
        )}

        {source && (
          <>
            <View style={styles.previewRow}>
              <View style={styles.previewCol}>
                <Text style={[styles.previewLabel, { color: colors.mutedForeground }]}>Original</Text>
                <View style={[styles.previewFrame, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Image source={{ uri: source.uri }} style={styles.previewImage} resizeMode="contain" />
                </View>
              </View>
              <View style={styles.previewCol}>
                <Text style={[styles.previewLabel, { color: colors.mutedForeground }]}>Cutout</Text>
                <View style={[styles.previewFrame, styles.checkerboard, { borderColor: colors.border }]}>
                  {loading ? (
                    <View style={styles.loadingRow}>
                      <View style={styles.loadingDots}>
                        {[0, 1, 2].map((i) => (
                          <View key={i} style={[styles.loadDot, { backgroundColor: colors.primary }]} />
                        ))}
                      </View>
                    </View>
                  ) : resultB64 ? (
                    <Image
                      source={{ uri: `data:image/png;base64,${resultB64}` }}
                      style={styles.previewImage}
                      resizeMode="contain"
                    />
                  ) : (
                    <Feather name="image" size={24} color={colors.mutedForeground} />
                  )}
                </View>
              </View>
            </View>

            <View style={styles.actions}>
              {!resultB64 && (
                <TouchableOpacity
                  onPress={removeBackground}
                  activeOpacity={0.85}
                  disabled={loading}
                  style={[styles.primaryBtn, { backgroundColor: loading ? colors.secondary : colors.primary }]}
                >
                  <Text style={[styles.primaryBtnText, { color: loading ? colors.mutedForeground : colors.primaryForeground }]}>
                    {loading ? 'Removing background…' : 'Remove background'}
                  </Text>
                </TouchableOpacity>
              )}

              {resultB64 && (
                <TouchableOpacity
                  onPress={saveToCameraRoll}
                  activeOpacity={0.85}
                  disabled={saving}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Feather name="download" size={16} color={colors.primaryForeground} />
                  <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                    {saving ? 'Saving…' : 'Save to camera roll'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={startOver} activeOpacity={0.7} style={styles.secondaryBtn}>
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>Choose a different photo</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  dropzone: {
    borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center',
    justifyContent: 'center', paddingVertical: 56, gap: 10, marginTop: 12,
  },
  dropzoneTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  dropzoneSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 32 },
  previewRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  previewCol: { flex: 1, gap: 6 },
  previewLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.4 },
  previewFrame: {
    aspectRatio: 1, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  checkerboard: { backgroundColor: '#CBD5C0' },
  previewImage: { width: '100%', height: '100%' },
  loadingRow: { alignItems: 'center', justifyContent: 'center' },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 8, height: 8, borderRadius: 4, opacity: 0.6 },
  actions: { marginTop: 24, gap: 12 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 15,
  },
  primaryBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  secondaryBtn: { alignItems: 'center', paddingVertical: 8 },
  secondaryBtnText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
});

/**
 * Seller onboarding — first product: one photo (camera or library), a name
 * and a price, published as an active listing through the same endpoints as
 * Add product (POST /api/products/images, then POST /api/products). Sizes,
 * stock and details are edited later in Add product. "Do it later" skips.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CachedImage } from '@/components/CachedImage';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { useApi } from '@/lib/api';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { Body, Field, Headline, ONB_TYPE, SquareButton, StepScreen, TextAction, useKitTheme } from './kit';

/** "$88" / "88.5" / "1,200" → cents; null when it isn't a positive price. */
export function parsePriceCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents > 0 ? cents : null;
}

/** The SKU the one starting variant gets; editable later in Add product. */
export function firstSku(name: string): string {
  const base = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'ITEM';
  return `${base}-1`;
}

type Photo = { localUri: string; remotePath: string | null; status: 'uploading' | 'done' | 'error' };

export function FirstProductStep({
  counter,
  onPublished,
  onSkip,
}: {
  counter: { current: number; total: number } | null;
  onPublished: (productId: string) => void;
  onSkip: () => void;
}) {
  const theme = useKitTheme();
  const api = useApi();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  const priceCents = parsePriceCents(price);
  const canPublish = photo?.status === 'done' && name.trim().length > 0 && priceCents !== null;

  async function upload(localUri: string) {
    setPhoto({ localUri, remotePath: null, status: 'uploading' });
    try {
      const uploaded = await api.products.uploadImage({ uri: localUri });
      const remotePath = (uploaded as any)?.objectPath || (uploaded as any)?.url || null;
      setPhoto({ localUri, remotePath, status: remotePath ? 'done' : 'error' });
    } catch {
      setPhoto({ localUri, remotePath: null, status: 'error' });
    }
  }

  async function fromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!result.canceled && result.assets[0]) void upload(result.assets[0].uri);
  }

  async function fromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to choose a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!result.canceled && result.assets[0]) void upload(result.assets[0].uri);
  }

  function pickPhoto() {
    // The browser has no camera sheet worth showing; go straight to files.
    if (Platform.OS === 'web') { void fromLibrary(); return; }
    showActionSheet('Product photo', undefined, [
      { text: 'Take Photo', onPress: () => { void fromCamera(); } },
      { text: 'Choose from Library', onPress: () => { void fromLibrary(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function publish() {
    if (!canPublish || publishing || !photo?.remotePath || priceCents === null) return;
    setPublishing(true);
    setError('');
    try {
      const created = await completeSetupTaskAfter('first_product', () => api.products.create({
        name: name.trim(),
        status: 'active',
        images: [photo.remotePath],
        variants: [{ sku: firstSku(name), priceCents, stock: 1, lowStockThreshold: 0 }],
      })) as { id?: string } | null;
      if (!created?.id) throw new Error('No product id');
      onPublished(created.id);
    } catch {
      setError("Couldn't publish. Check your connection and try again.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <StepScreen
      counter={counter}
      testID="onboarding-first-product"
      footer={(
        <>
          <SquareButton testID="onboarding-publish" label="Publish" onPress={() => { void publish(); }} disabled={!canPublish} loading={publishing} />
          <TextAction label="Do it later" onPress={onSkip} testID="onboarding-product-later" />
        </>
      )}
    >
      <Headline>List your first piece</Headline>
      <Body>A photo, a name and a price. Sizes and details can come later.</Body>

      <Pressable
        onPress={pickPhoto}
        accessibilityRole="button"
        accessibilityLabel={photo ? 'Change photo' : 'Add photo'}
        testID="onboarding-product-photo"
        style={[styles.photo, { borderColor: theme.muted, backgroundColor: theme.surface }]}
      >
        {photo ? <CachedImage source={{ uri: photo.localUri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        {photo?.status === 'uploading' ? <ActivityIndicator color={theme.text} /> : null}
        {!photo ? <Text style={[ONB_TYPE.caps, { color: theme.text }]}>ADD PHOTO</Text> : null}
      </Pressable>
      {photo?.status === 'error' ? (
        <Text style={[ONB_TYPE.small, { color: theme.error, marginTop: 8 }]}>The photo didn't upload. Tap it to try again.</Text>
      ) : null}

      <Field
        testID="onboarding-product-name"
        label="Name"
        placeholder="e.g. Heavyweight Hoodie"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={80}
      />
      <Field
        testID="onboarding-product-price"
        label="Price"
        prefix="$"
        placeholder="0"
        value={price}
        onChangeText={(t) => setPrice(t.replace(/[^\d.]/g, ''))}
        keyboardType="decimal-pad"
        maxLength={9}
      />
      {error ? <Text style={[ONB_TYPE.small, { color: theme.error, marginTop: 16 }]}>{error}</Text> : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  photo: {
    marginTop: 24, width: 148, aspectRatio: 3 / 4, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 0,
  },
});

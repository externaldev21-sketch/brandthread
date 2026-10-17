/**
 * Instagram-style "change profile photo" sheet — Take Photo / Choose from
 * Library, with an optional destructive Remove row — used wherever a screen
 * lets someone replace an avatar/logo/banner (buyer + seller edit profile).
 *
 * Replaces the old `pickProfileImage()` flow, which asked the same question
 * through `Alert.alert` with multiple buttons — a real native alert on iOS/
 * Android, but a silent no-op on react-native-web (RN's Alert has no web
 * implementation upstream), so the whole "change photo" tap did nothing on
 * web. A real `<BottomSheet>` works identically on every platform.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type * as ImagePicker from 'expo-image-picker';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { hapticSelection } from '@/lib/haptics';
import { pickFromCamera, pickFromLibrary, pickVideoFromLibrary, recordAvatarVideo } from '@/lib/pickProfileImage';
import { AvatarCropper, type AvatarCropResult, type AvatarCropSource } from '@/components/profile/AvatarCropper';

export const AVATAR_VIDEO_MAX_SECONDS = 10;

function SourceRow({
  icon, label, destructive, onPress, last,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, !last && [styles.rowDivider, { borderColor: theme.border }], pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={22} color={destructive ? theme.error : theme.text} />
      <Text style={[styles.rowText, { color: destructive ? theme.error : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Mounts once per screen and serves every image slot on it (avatar, logo,
 * banner, …) — `open({ aspect })` shows the sheet and resolves with the
 * picked asset (or null if dismissed/cancelled) — the same promise-based
 * shape `pickProfileImage()` had, so call sites barely change. Pass
 * `onRemove` to also offer a destructive "Remove Current Photo" row; it
 * resolves the same promise with `null` after running.
 *
 * Pass `enableVideo: true` (avatar slots only) to also offer "Choose Video"
 * / "Record Video" rows. The resolved asset is the same
 * `ImagePicker.ImagePickerAsset` either way — its own `type` field
 * ('image' | 'video') is the discriminator, so this never changes the
 * hook's return type for the photo-only call sites (seller logo/banner)
 * that don't pass the flag.
 *
 * Pass `cropCircle: true` (profile-picture slots) to skip the system square
 * `allowsEditing` crop and instead show the full-screen circular
 * move-and-scale step (AvatarCropper) after a photo is picked or taken. The
 * promise then resolves with an 800x800 JPEG of exactly what was inside the
 * circle — or null if the person cancels the crop. Videos skip the crop.
 */
export function useImageSourceSheet() {
  const [visible, setVisible] = useState(false);
  const resolverRef = useRef<((asset: ImagePicker.ImagePickerAsset | null) => void) | null>(null);
  const onRemoveRef = useRef<(() => void) | undefined>(undefined);
  const aspectRef = useRef<[number, number]>([1, 1]);
  const nativeEditRef = useRef(true);
  const [enableVideo, setEnableVideo] = useState(false);
  const cropCircleRef = useRef(false);
  const pendingAssetRef = useRef<ImagePicker.ImagePickerAsset | null>(null);
  const [cropSource, setCropSource] = useState<AvatarCropSource | null>(null);

  const settle = useCallback((asset: ImagePicker.ImagePickerAsset | null) => {
    setVisible(false);
    resolverRef.current?.(asset);
    resolverRef.current = null;
  }, []);

  const open = useCallback((opts?: { aspect?: [number, number]; onRemove?: () => void; enableVideo?: boolean; skipNativeEdit?: boolean; cropCircle?: boolean }) => {
    aspectRef.current = opts?.aspect ?? [1, 1];
    cropCircleRef.current = !!opts?.cropCircle;
    nativeEditRef.current = !opts?.skipNativeEdit && !opts?.cropCircle;
    onRemoveRef.current = opts?.onRemove;
    setEnableVideo(!!opts?.enableVideo);
    setVisible(true);
    return new Promise<ImagePicker.ImagePickerAsset | null>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  /** Photo picked: either hand it straight back, or route it through the circle crop first. */
  const settlePhoto = useCallback((asset: ImagePicker.ImagePickerAsset | null) => {
    if (!asset || !cropCircleRef.current || asset.type === 'video') { settle(asset); return; }
    // The crop is its own full-screen Modal: open it only once the sheet's
    // Modal has finished closing (BottomSheet calls onClose again when its
    // close animation completes — see onSheetClose below), since iOS can't
    // present a second modal while another one is still dismissing.
    pendingAssetRef.current = asset;
    setVisible(false);
  }, [settle]);

  const onSheetClose = useCallback(() => {
    const asset = pendingAssetRef.current;
    if (asset) setCropSource({ uri: asset.uri, width: asset.width, height: asset.height });
    else settle(null);
  }, [settle]);

  const cancelCrop = useCallback(() => {
    pendingAssetRef.current = null;
    setCropSource(null);
    settle(null);
  }, [settle]);

  const finishCrop = useCallback((result: AvatarCropResult) => {
    const original = pendingAssetRef.current;
    pendingAssetRef.current = null;
    setCropSource(null);
    settle(original ? {
      ...original,
      uri: result.uri,
      width: result.width,
      height: result.height,
      type: 'image',
      mimeType: 'image/jpeg',
      fileName: 'avatar.jpg',
      fileSize: undefined,
      base64: undefined,
      exif: undefined,
    } : null);
  }, [settle]);

  const takePhoto = useCallback(async () => {
    hapticSelection();
    const asset = await pickFromCamera(aspectRef.current, nativeEditRef.current);
    settlePhoto(asset);
  }, [settlePhoto]);

  const chooseLibrary = useCallback(async () => {
    hapticSelection();
    const asset = await pickFromLibrary(aspectRef.current, nativeEditRef.current);
    settlePhoto(asset);
  }, [settlePhoto]);

  const chooseVideo = useCallback(async () => {
    hapticSelection();
    const asset = await pickVideoFromLibrary();
    settle(asset);
  }, [settle]);

  const recordVideo = useCallback(async () => {
    hapticSelection();
    const asset = await recordAvatarVideo(AVATAR_VIDEO_MAX_SECONDS);
    settle(asset);
  }, [settle]);

  const remove = useCallback(() => {
    hapticSelection();
    onRemoveRef.current?.();
    settle(null);
  }, [settle]);

  const hasRemove = !!onRemoveRef.current;
  const sheet = (
    <>
    <BottomSheet visible={visible} onClose={onSheetClose} testID="image-source-sheet">
      <SourceRow icon="camera" label="Take Photo" onPress={() => { void takePhoto(); }} />
      <SourceRow icon="image" label="Choose from Library" onPress={() => { void chooseLibrary(); }} last={!enableVideo && !hasRemove} />
      {enableVideo ? (
        <>
          <SourceRow icon="video" label="Record Video" onPress={() => { void recordVideo(); }} />
          <SourceRow icon="film" label="Choose Video" onPress={() => { void chooseVideo(); }} last={!hasRemove} />
        </>
      ) : null}
      {hasRemove ? (
        <SourceRow icon="trash-2" label="Remove Current Photo" destructive onPress={remove} last />
      ) : null}
    </BottomSheet>
    <AvatarCropper source={cropSource} onCancel={cancelCrop} onDone={finishCrop} />
    </>
  );

  return { open, sheet };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 16, paddingHorizontal: SP.md, minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { opacity: 0.6 },
  rowText: { fontFamily: FONT.medium, fontSize: FS.base },
});

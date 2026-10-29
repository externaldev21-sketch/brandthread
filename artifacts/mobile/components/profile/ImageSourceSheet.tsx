/**
 * "Change profile photo" source picker — Take photo / Choose from library,
 * with an optional destructive Remove row — used wherever a screen lets
 * someone replace an avatar/logo/banner (buyer + seller edit profile).
 *
 * A 1:1 copy of the iOS photo-source action sheet, so it is the shared
 * `showActionSheet` (components/ui/ActionSheet.tsx): an inset group of
 * centred rows, the destructive row in the error colour, Cancel split off
 * below. That sheet runs a row's action only once it has finished closing,
 * so the system camera / photo library never tries to present over a sheet
 * that is still on screen.
 *
 * Replaces the old `pickProfileImage()` flow, which asked the same question
 * through `Alert.alert` — a silent no-op on react-native-web.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import type * as ImagePicker from 'expo-image-picker';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { haptics, hapticSelection } from '@/lib/haptics';
import { showActionSheet, type ActionSheetButton } from '@/components/ui/ActionSheet';
import { pickFromCamera, pickFromLibrary, pickVideoFromLibrary, recordAvatarVideo } from '@/lib/pickProfileImage';
import { AvatarCropper, type AvatarCropResult } from './AvatarCropper';

export const AVATAR_VIDEO_MAX_SECONDS = 10;

/**
 * One per screen, serving every image slot on it (avatar, logo, banner, …)
 * — `open({ aspect })` shows the sheet and resolves with the
 * picked asset (or null if dismissed/cancelled) — the same promise-based
 * shape `pickProfileImage()` had, so call sites barely change. Pass
 * `onRemove` to also offer a destructive "Remove current photo" row; it
 * resolves the same promise with `null` after running.
 *
 * Pass `enableVideo: true` (avatar slots only) to also offer "Choose video"
 * / "Record video" rows. The resolved asset is the same
 * `ImagePicker.ImagePickerAsset` either way — its own `type` field
 * ('image' | 'video') is the discriminator, so this never changes the
 * hook's return type for the photo-only call sites (seller logo/banner)
 * that don't pass the flag.
 */
export function useImageSourceSheet() {
  const resolverRef = useRef<((asset: ImagePicker.ImagePickerAsset | null) => void) | null>(null);
  const aspectRef = useRef<[number, number]>([1, 1]);
  const nativeEditRef = useRef(true);
  const circleRef = useRef(false);
  const [cropAsset, setCropAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const settle = useCallback((asset: ImagePicker.ImagePickerAsset | null) => {
    resolverRef.current?.(asset);
    resolverRef.current = null;
  }, []);

  const run = useCallback((pick: () => Promise<ImagePicker.ImagePickerAsset | null>) => async () => {
    hapticSelection();
    let asset: ImagePicker.ImagePickerAsset | null;
    try {
      asset = await pick();
    } catch {
      // The camera / library failed to open (no camera, picker error): answer
      // the caller instead of leaving its open() promise pending forever.
      settle(null);
      return;
    }
    if (asset && circleRef.current && asset.type !== 'video') setCropAsset(asset);
    else settle(asset);
  }, [settle]);

  const open = useCallback((opts?: { aspect?: [number, number]; onRemove?: () => void; enableVideo?: boolean; skipNativeEdit?: boolean; cropCircle?: boolean }) => {
    // A sheet swiped away never answers; settle it before asking again.
    settle(null);
    setCropAsset(null);
    circleRef.current = !!opts?.cropCircle;
    aspectRef.current = opts?.aspect ?? [1, 1];
    nativeEditRef.current = !opts?.skipNativeEdit && !opts?.cropCircle;
    const onRemove = opts?.onRemove;
    const buttons: ActionSheetButton[] = [
      { text: 'Take photo', onPress: () => { void run(() => pickFromCamera(aspectRef.current, nativeEditRef.current))(); } },
      { text: 'Choose from library', onPress: () => { void run(() => pickFromLibrary(aspectRef.current, nativeEditRef.current))(); } },
    ];
    if (opts?.enableVideo) {
      buttons.push(
        { text: 'Record video', onPress: () => { void run(() => recordAvatarVideo(AVATAR_VIDEO_MAX_SECONDS))(); } },
        { text: 'Choose video', onPress: () => { void run(pickVideoFromLibrary)(); } },
      );
    }
    if (onRemove) {
      buttons.push({
        text: 'Remove current photo',
        style: 'destructive',
        onPress: () => { hapticSelection(); onRemove(); settle(null); },
      });
    }
    buttons.push({ text: 'Cancel', style: 'cancel', onPress: () => settle(null) });
    const result = new Promise<ImagePicker.ImagePickerAsset | null>((resolve) => {
      resolverRef.current = resolve;
    });
    showActionSheet(undefined, undefined, buttons);
    return result;
  }, [run, settle]);

  // Kept so call sites that render `{sheet}` need no change: the action
  // sheet itself is hosted once at the app root.
  const finishCrop = useCallback((result: AvatarCropResult) => {
    const original = cropAsset;
    setCropAsset(null);
    settle(original ? { ...original, ...result, type: 'image', mimeType: 'image/jpeg', fileName: 'avatar.jpg', fileSize: undefined, base64: undefined, exif: undefined } : null);
  }, [cropAsset, settle]);
  const sheet = <AvatarCropper source={cropAsset} onCancel={() => { setCropAsset(null); settle(null); }} onDone={finishCrop} />;

  return { open, sheet };
}

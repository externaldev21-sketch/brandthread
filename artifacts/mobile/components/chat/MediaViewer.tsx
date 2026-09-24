import React, { useRef, useState } from 'react';
import {
  Alert, Animated, Modal, PanResponder, Platform, Share, StyleSheet,
  Text, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { saveImageToMediaLibrary } from '@/lib/mediaLibraryAdapter';

/**
 * Full-screen photo viewer: pinch-to-zoom (two-finger, same touch-distance
 * technique used by the product gallery in buyer-product-detail.tsx) and
 * swipe-down-to-close, with save-to-library and share actions.
 */
export default function MediaViewer({
  visible, uri, onClose,
}: {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const scale = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(1)).current;
  const currentScale = useRef(1);
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const dragStartY = useRef(0);
  const [isSaving, setIsSaving] = useState(false);

  const distance = (touches: readonly any[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const resetTransform = () => {
    currentScale.current = 1;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  };

  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (event, gesture) =>
      event.nativeEvent.touches.length === 2 || Math.abs(gesture.dy) > 6,
    onPanResponderGrant: (event) => {
      dragStartY.current = 0;
      if (event.nativeEvent.touches.length === 2) {
        pinchStartDistance.current = distance(event.nativeEvent.touches);
        pinchStartScale.current = currentScale.current;
      }
    },
    onPanResponderMove: (event, gesture) => {
      if (event.nativeEvent.touches.length === 2) {
        const nextDistance = distance(event.nativeEvent.touches);
        if (!pinchStartDistance.current || !nextDistance) return;
        const nextScale = Math.max(1, Math.min(4, pinchStartScale.current * nextDistance / pinchStartDistance.current));
        currentScale.current = nextScale;
        scale.setValue(nextScale);
      } else if (currentScale.current <= 1.01) {
        // Single-finger drag while unzoomed: swipe down to dismiss.
        translateY.setValue(gesture.dy > 0 ? gesture.dy : gesture.dy * 0.25);
        backdropOpacity.setValue(Math.max(0.4, 1 - gesture.dy / (height * 0.6)));
      }
    },
    onPanResponderRelease: (_event, gesture) => {
      if (currentScale.current > 1.01) {
        if (currentScale.current < 1.06) resetTransform();
        return;
      }
      if (gesture.dy > 120) {
        onClose();
        return;
      }
      resetTransform();
    },
    onPanResponderTerminate: () => resetTransform(),
  })).current;

  const handleClose = () => {
    currentScale.current = 1;
    scale.setValue(1);
    translateY.setValue(0);
    backdropOpacity.setValue(1);
    onClose();
  };

  async function handleSave() {
    if (!uri) return;
    setIsSaving(true);
    try {
      const result = await saveImageToMediaLibrary(uri);
      if (result === 'saved') Alert.alert('Saved', 'Photo saved to your library.');
      else if (result === 'denied') Alert.alert('Permission needed', 'Allow photo library access in Settings to save.');
      else Alert.alert('Unavailable', 'Saving photos is not available here.');
    } catch {
      Alert.alert('Save failed', 'Could not save the photo.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleShare() {
    if (!uri) return;
    try {
      await Share.share(Platform.OS === 'ios' ? { url: uri } : { message: uri });
    } catch {
      // User cancelled or share sheet failed silently — nothing to surface.
    }
  }

  if (!uri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
        <View style={[s.topBar, { paddingTop: 12 }]}>
          <TouchableOpacity style={s.iconBtn} onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity style={s.iconBtn} onPress={handleShare} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="share" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={handleSave} disabled={isSaving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="download" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
        <View style={[s.imageWrap, { width, height }]} {...responder.panHandlers}>
          <Animated.Image
            source={{ uri }}
            resizeMode="contain"
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateY }, { scale }] },
            ]}
          />
        </View>
        <Text style={s.hint}>Pinch to zoom · Swipe down to close</Text>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 8,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  imageWrap: { alignItems: 'center', justifyContent: 'center' },
  hint: {
    position: 'absolute', bottom: 28, alignSelf: 'center',
    color: 'rgba(255,255,255,0.6)', fontSize: 12,
  },
});

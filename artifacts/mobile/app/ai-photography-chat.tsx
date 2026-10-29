import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/layout/EmptyState';
import Composer from '@/components/ui/Composer';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useApi } from '@/hooks/useApi';
import { AiGeneratedBadge } from '@/components/AiGeneratedBadge';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { FONT, FS } from '@/lib/theme';
import { radius } from '@/constants/radii';
import { minHitSlop } from '@/lib/hitSlop';
import { aiToolErrorMessage } from '@/components/ai-tools/aiToolErrorMessage';

interface UploadedPhoto {
  id: string;
  uri: string;
  base64: string;
  mime: string;
}

type PhotographyMode = 'free' | 'outfitSwap';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  photos?: string[]; // uris of the photos the user attached with this message
  photoLabels?: string[];
  image?: string; // base64 result
  error?: boolean;
  retryGarment?: UploadedPhoto;
  garmentIndex?: number;
  retryPrompt?: string;
  /** Whole-request failure: what Retry re-sends (the tray keeps these photos too). */
  retryRequest?: RetryRequest;
}

type RetryRequest =
  | { kind: 'free'; photos: UploadedPhoto[]; prompt: string }
  | { kind: 'outfitSwap'; garments: UploadedPhoto[]; prompt: string };

const MAX_PHOTOS = 4;
const MAX_GARMENTS = 4;

const INITIAL_MSG: Message = {
  id: '0',
  role: 'assistant',
  content: "Add product photos and references, then describe the style.",
};

/** The greeting bubble's copy for each mode (the thread is shared). */
const INITIAL_COPY: Record<PhotographyMode, string> = {
  free: INITIAL_MSG.content,
  outfitSwap: 'Upload one hero photo of the model and scene, then add garment mockups to swap in.',
};

const isAbortError = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

export default function AIPhotographyChatScreen() {
  const colors = useColors();
  const api = useApi();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MSG]);
  const [mode, setMode] = useState<PhotographyMode>('free');
  const outfitSwapEnabled = useFeatureFlag('outfitSwap');
  const [input, setInput] = useState('');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [heroPhoto, setHeroPhoto] = useState<UploadedPhoto | null>(null);
  /** The hero is only "locked" once it has been sent into the thread. */
  const [heroLocked, setHeroLocked] = useState(false);
  const [garments, setGarments] = useState<UploadedPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const flatRef = useRef<FlatList>(null);
  // In-flight generation: Cancel aborts the request; elapsed time shows progress.
  const abortRef = useRef<AbortController | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!loading) return;
    setElapsedSec(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsedSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  // Leaving the screen cancels a generation that is still running.
  useEffect(() => () => abortRef.current?.abort(), []);

  function beginRequest(): AbortSignal {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    return controller.signal;
  }

  function cancelGeneration() {
    abortRef.current?.abort();
  }


  useEffect(() => {
    if (!outfitSwapEnabled && mode === 'outfitSwap') setMode('free');
  }, [mode, outfitSwapEnabled]);

  async function pickPhotos(opts: { replaceHero?: boolean } = {}) {
    const replaceHero = !!opts.replaceHero && mode === 'outfitSwap' && !heroLocked;
    const remaining = replaceHero
      ? 1
      : mode === 'outfitSwap'
        ? (heroPhoto ? MAX_GARMENTS - garments.length : MAX_GARMENTS + 1)
        : MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access to upload product photos.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const picked: UploadedPhoto[] = result.assets
      .filter((a) => !!a.base64)
      .slice(0, remaining)
      .map((a) => ({
        id: `${Date.now()}-${a.assetId ?? a.uri}`,
        uri: a.uri,
        base64: a.base64 as string,
        mime: a.mimeType ?? 'image/jpeg',
      }));
    if (replaceHero) {
      if (picked[0]) setHeroPhoto(picked[0]);
    } else if (mode === 'outfitSwap') {
      if (!heroPhoto && picked.length > 0) {
        setHeroPhoto(picked[0]);
        // Garments can remain from a removed (unlocked) hero; keep the cap.
        setGarments((prev) => [...prev, ...picked.slice(1)].slice(0, MAX_GARMENTS));
      } else {
        setGarments((prev) => [...prev, ...picked].slice(0, MAX_GARMENTS));
      }
    } else {
      setPhotos((prev) => [...prev, ...picked]);
    }
  }

  function removePhoto(id: string) {
    if (mode === 'outfitSwap') {
      setGarments((prev) => prev.filter((p) => p.id !== id));
      return;
    }
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  /** Before it is locked, a picked hero can simply be removed. */
  function removeHero() {
    if (heroLocked || loading) return;
    setHeroPhoto(null);
  }

  function resetOutfitSwap() {
    Alert.alert(
      'Start a new Outfit Swap?',
      'This releases the locked hero photo. Your previous messages and generated images will stay in the thread.',
      [
        { text: 'Keep current hero', style: 'cancel' },
        {
          text: 'Start new swap',
          style: 'destructive',
          onPress: () => {
            setHeroPhoto(null);
            setHeroLocked(false);
            setGarments([]);
            setMessages((prev) => [{
              id: `${Date.now()}-new-outfit-swap`,
              role: 'assistant',
              content: 'New Outfit Swap started. Upload one hero photo to lock a new model, pose, framing, and background.',
            }, ...prev]);
          },
        },
      ],
    );
  }

  async function sendFreeMessage(text: string) {
    if ((!text.trim() && photos.length === 0) || loading) return;
    if (photos.length === 0) return; // need at least one product photo
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const attached = photos;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim() || 'Generate a studio photo from these photos.',
      photos: attached.map((p) => p.uri),
    };
    setMessages((prev) => [userMsg, ...prev]);
    setInput('');
    await runFree({ kind: 'free', photos: attached, prompt: text.trim() });
  }

  /** One free-mode generation. The tray is only cleared once it succeeds. */
  async function runFree(req: Extract<RetryRequest, { kind: 'free' }>) {
    const signal = beginRequest();
    try {
      const dataUrls = req.photos.map((p) => `data:${p.mime};base64,${p.base64}`);
      const result = await api.photography.generate(dataUrls, req.prompt, 'photoshoot', { signal });
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result?.b64_json
          ? "Here's your studio photo."
          : "I couldn't generate that photo. Please try again with different photos.",
        image: result?.b64_json,
        error: !result?.b64_json,
        retryRequest: result?.b64_json ? undefined : req,
      };
      setMessages((prev) => [aiMsg, ...prev]);
      if (result?.b64_json) {
        const sent = new Set(req.photos.map((p) => p.id));
        setPhotos((prev) => prev.filter((p) => !sent.has(p.id)));
      }
    } catch (err: unknown) {
      setMessages((prev) => [failureMessage(err, req), ...prev]);
    } finally {
      endRequest(signal);
    }
  }

  function endRequest(signal: AbortSignal) {
    if (abortRef.current?.signal === signal) abortRef.current = null;
    setLoading(false);
  }

  function failureMessage(err: unknown, req: RetryRequest): Message {
    const cancelled = isAbortError(err);
    return {
      id: `${Date.now()}-${req.kind}-error`,
      role: 'assistant',
      content: cancelled
        ? 'Cancelled. Your photos are still attached.'
        : aiToolErrorMessage(err, "Couldn't create that photo. Please try again."),
      error: !cancelled,
      retryRequest: req,
    };
  }

  /** Retry a whole-request failure with the same photos and prompt. */
  async function retryRequest(message: Message) {
    const req = message.retryRequest;
    if (!req || loading) return;
    if (req.kind === 'outfitSwap' && !heroPhoto) return;
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    if (req.kind === 'free') await runFree(req);
    else await runOutfitSwap(req);
  }

  async function sendOutfitSwap(text: string) {
    if (!heroPhoto || loading) return;

    // A hero-only message locks the photoshoot into the conversation so
    // garment designs can arrive in later chat messages.
    if (garments.length === 0) {
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: text.trim() || 'Lock this hero photo for Outfit Swap.',
        photos: [heroPhoto.uri],
        photoLabels: ['Locked hero photo'],
      };
      const aiMsg: Message = {
        id: `${Date.now()}-locked`,
        role: 'assistant',
        content: 'Hero photo locked. Upload one or more garment mockups in this chat and I’ll keep the same model, pose, framing, and background for each result.',
      };
      setMessages((prev) => [aiMsg, userMsg, ...prev]);
      setInput('');
      setHeroLocked(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const attachedGarments = garments;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim() || `Swap the hero outfit for ${attachedGarments.length} garment design${attachedGarments.length === 1 ? '' : 's'}.`,
      photos: [heroPhoto.uri, ...attachedGarments.map((p) => p.uri)],
      photoLabels: ['Locked hero', ...attachedGarments.map((_p, index) => `Garment ${index + 1}`)],
    };
    setMessages((prev) => [userMsg, ...prev]);
    setInput('');
    setHeroLocked(true);
    await runOutfitSwap({ kind: 'outfitSwap', garments: attachedGarments, prompt: text.trim() });
  }

  /** One Outfit Swap request. The garment tray is only cleared once it succeeds. */
  async function runOutfitSwap(req: Extract<RetryRequest, { kind: 'outfitSwap' }>) {
    if (!heroPhoto) return;
    const attachedGarments = req.garments;
    const signal = beginRequest();
    try {
      const heroDataUrl = `data:${heroPhoto.mime};base64,${heroPhoto.base64}`;
      const garmentDataUrls = attachedGarments.map((p) => `data:${p.mime};base64,${p.base64}`);
      const result = await api.photography.generateOutfitSwap(heroDataUrl, garmentDataUrls, req.prompt, { signal });
      const resultMessages: Message[] = (result?.results ?? []).map((item: { b64_json?: string; garmentIndex?: number }, index: number) => {
        const garmentIndex = item.garmentIndex ?? index + 1;
        return {
          id: `${Date.now()}-result-${index}`,
          role: 'assistant',
          content: item.b64_json
            ? `Outfit Swap result ${index + 1} of ${attachedGarments.length} — garment ${garmentIndex} on the locked hero scene.`
            : `Garment ${garmentIndex} could not be generated.`,
          image: item.b64_json,
          error: !item.b64_json,
          garmentIndex,
          retryGarment: attachedGarments[garmentIndex - 1],
          retryPrompt: req.prompt,
        };
      });
      if (resultMessages.length === 0 && !result?.errors?.length) {
        throw new Error('No outfit swap results were returned. Please try again.');
      }
      if (result?.errors?.length) {
        result.errors.forEach((failure: { garmentIndex?: number }) => {
          const garmentIndex = failure.garmentIndex ?? resultMessages.length + 1;
          resultMessages.push({
            id: `${Date.now()}-error-${failure.garmentIndex ?? resultMessages.length}`,
            role: 'assistant',
            content: `Garment ${garmentIndex} could not be generated. Please try that design again.`,
            error: true,
            garmentIndex,
            retryGarment: attachedGarments[garmentIndex - 1],
            retryPrompt: req.prompt,
          });
        });
      }
      setMessages((prev) => [...resultMessages, ...prev]);
      // The request went through (per-garment failures keep their own Retry).
      const sent = new Set(attachedGarments.map((p) => p.id));
      setGarments((prev) => prev.filter((p) => !sent.has(p.id)));
    } catch (err: unknown) {
      setMessages((prev) => [failureMessage(err, req), ...prev]);
    } finally {
      endRequest(signal);
    }
  }

  async function retryOutfitSwap(message: Message) {
    if (!heroPhoto || !message.retryGarment || retryingMessageId) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRetryingMessageId(message.id);
    setMessages((prev) => prev.map((item) => item.id === message.id
      ? { ...item, content: `Retrying garment ${message.garmentIndex ?? ''}…`.replace('  ', ' '), error: true }
      : item));

    try {
      const heroDataUrl = `data:${heroPhoto.mime};base64,${heroPhoto.base64}`;
      const garmentDataUrl = `data:${message.retryGarment.mime};base64,${message.retryGarment.base64}`;
      const result = await api.photography.retryOutfitSwap(
        heroDataUrl,
        garmentDataUrl,
        message.garmentIndex ?? 1,
        message.retryPrompt ?? '',
      );
      if (!result?.b64_json) {
        throw new Error('This garment could not be generated. Please try again.');
      }
      setMessages((prev) => prev.map((item) => item.id === message.id
        ? {
            ...item,
            content: `Outfit Swap result — garment ${message.garmentIndex ?? 1} on the locked hero scene.`,
            image: result.b64_json,
            error: false,
          }
        : item));
    } catch (err: any) {
      setMessages((prev) => prev.map((item) => item.id === message.id
        ? {
            ...item,
            content: `Garment ${message.garmentIndex ?? 1} didn't work. Tap Retry.`,
            error: true,
          }
        : item));
    } finally {
      setRetryingMessageId(null);
    }
  }

  async function sendMessage(text: string) {
    if (mode === 'outfitSwap') {
      await sendOutfitSwap(text);
    } else {
      await sendFreeMessage(text);
    }
  }

  // Nothing sent yet: only the greeting is in the thread.
  const isFreshThread = !loading && messages.every((m) => m.id === INITIAL_MSG.id);
  const addPhotosDisabled = mode === 'free'
    ? photos.length >= MAX_PHOTOS
    : (heroPhoto ? garments.length >= MAX_GARMENTS : false);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: 'transparent' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader title="Product photography" divider={false} />

      {/* Chat mode switch — both modes share the same thread and composer.
          Only shown when Outfit Swap is enabled; otherwise Product Photography is the only mode. */}
      {outfitSwapEnabled && (
        <View style={[styles.modeSwitch, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={() => setMode('free')}
            disabled={loading}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === 'free', disabled: loading }}
            testID="ai-photography-mode-free"
            hitSlop={MODE_CHIP_HIT_SLOP}
            style={[styles.modeChip, { borderColor: colors.border }, mode === 'free' && { backgroundColor: colors.primary, borderColor: colors.primary }]}
          >
            <Icon name="edit-3" size={14} color={mode === 'free' ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[styles.modeChipText, { color: mode === 'free' ? colors.primaryForeground : colors.mutedForeground }]}>
              Photography
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={() => setMode('outfitSwap')}
            disabled={loading}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === 'outfitSwap', disabled: loading }}
            testID="ai-photography-mode-outfit-swap"
            hitSlop={MODE_CHIP_HIT_SLOP}
            style={[styles.modeChip, { borderColor: colors.border }, mode === 'outfitSwap' && { backgroundColor: colors.primary, borderColor: colors.primary }]}
          >
            <Icon name="refresh-cw" size={14} color={mode === 'outfitSwap' ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[styles.modeChipText, { color: mode === 'outfitSwap' ? colors.primaryForeground : colors.mutedForeground }]}>
              Outfit Swap
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'outfitSwap' && (
        <View style={[styles.outfitNotice, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <Icon name="lock" size={14} color={colors.primary} />
          <Text style={[styles.outfitNoticeText, { color: colors.mutedForeground }]}>
            {heroPhoto && heroLocked
              ? 'Hero locked — upload garment mockups to keep the same scene.'
              : heroPhoto
                ? 'Send to lock this hero photo, or add garment mockups and send to swap.'
                : 'Upload one hero photo first. The model, pose, framing, and background stay locked.'}
          </Text>
        </View>
      )}

      {/* Messages — or, before anything has been sent, a proper empty state
          in the content area with the real first step (add photos), instead
          of a lone greeting bubble over a blank screen and a helper line
          above the input. */}
      {isFreshThread ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="camera"
            title={mode === 'outfitSwap' ? 'Add a hero photo' : 'Add your product photos'}
            message={mode === 'outfitSwap'
              ? 'Upload one photo of the model and scene, then add garments to swap in.'
              : "Add product photos and references, then describe the style."}
            actionLabel={addPhotosDisabled ? undefined : 'Add photos'}
            onAction={addPhotosDisabled ? undefined : () => { void pickPhotos(); }}
            testID="ai-photography-empty"
          />
        </View>
      ) : (
      <FlatList
        ref={flatRef}
        data={messages}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          loading ? (
            <View style={[styles.bubble, styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.loadingRow}>
                <View style={styles.loadingDots}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[styles.loadDot, { backgroundColor: colors.primary }]} />
                  ))}
                </View>
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                  {mode === 'outfitSwap' ? 'Generating your outfit swaps…' : 'Generating your studio photo…'}
                </Text>
              </View>
              <Text
                style={[styles.elapsedText, { color: colors.mutedForeground }]}
                accessibilityLiveRegion="polite"
                testID="ai-photography-elapsed"
              >
                {formatElapsed(elapsedSec)} · this can take up to a minute or two
              </Text>
              <Button
                label="Cancel"
                variant="secondary"
                size="compact"
                onPress={cancelGeneration}
                style={styles.retryBtn}
                accessibilityLabel="Cancel generation"
                testID="ai-photography-cancel"
              />
            </View>
          ) : null
        }
        renderItem={({ item: msg }) => (
          <View style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble, {
            backgroundColor: msg.role === 'user' ? colors.primary : colors.card,
            borderColor: msg.role === 'user' ? 'transparent' : (msg.error ? colors.destructive : colors.border),
          }]}>
            {msg.photos && msg.photos.length > 0 && (
              <View style={styles.attachedRow}>
                {msg.photos.map((uri: string, index: number) => (
                  <View key={`${uri}-${index}`} style={styles.attachedItem}>
                    <CachedImage source={{ uri }} style={styles.attachedThumb} contentFit="cover" />
                    {msg.photoLabels?.[index] && (
                      <Text style={[styles.attachedLabel, { color: msg.role === 'user' ? colors.primaryForeground : colors.mutedForeground }]}>
                        {msg.photoLabels[index]}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}
            <Text style={[styles.bubbleText, { color: msg.role === 'user' ? colors.primaryForeground : colors.foreground }]}>
              {msg.id === INITIAL_MSG.id ? INITIAL_COPY[mode] : msg.content}
            </Text>
            {msg.image && (
              <View>
                <CachedImage
                  source={{ uri: `data:image/png;base64,${msg.image}` }}
                  style={styles.resultImage}
                  contentFit="cover"
                />
                <AiGeneratedBadge />
              </View>
            )}
            {msg.error && msg.retryGarment && (
              <Button
                label="Retry"
                icon="refresh-cw"
                variant="secondary"
                size="compact"
                loading={retryingMessageId === msg.id}
                disabled={retryingMessageId !== null}
                onPress={() => retryOutfitSwap(msg)}
                style={styles.retryBtn}
                accessibilityLabel={`Retry garment ${msg.garmentIndex ?? ''}`}
              />
            )}
            {msg.retryRequest && (
              <Button
                label="Retry"
                icon="refresh-cw"
                variant="secondary"
                size="compact"
                disabled={loading || (msg.retryRequest.kind === 'outfitSwap' && !heroPhoto)}
                onPress={() => { void retryRequest(msg); }}
                style={styles.retryBtn}
                accessibilityLabel="Retry this photo"
                testID={`ai-photography-retry-${msg.id}`}
              />
            )}
          </View>
        )}
      />
      )}

      {/* Photo tray */}
      {mode === 'outfitSwap' && heroPhoto && !heroLocked && (
        <View style={[styles.lockedHeroTray, { backgroundColor: colors.card, borderColor: colors.border }]} testID="ai-photography-hero-unlocked">
          <CachedImage source={{ uri: heroPhoto.uri }} style={styles.trayThumb} contentFit="cover" />
          <View style={styles.lockedHeroCopy}>
            <Text style={[styles.lockedHeroTitle, { color: colors.foreground }]}>Hero photo</Text>
            <Text style={[styles.lockedHeroSub, { color: colors.mutedForeground }]}>Locks when you send</Text>
          </View>
          <TouchableOpacity
            style={[styles.resetHeroBtn, { borderColor: colors.border }]}
            onPress={() => { void pickPhotos({ replaceHero: true }); }}
            disabled={loading}
            activeOpacity={0.8}
            hitSlop={HERO_BTN_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Replace hero photo"
            testID="ai-photography-replace-hero"
          >
            <Icon name="refresh-cw" size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.resetHeroBtn, styles.heroBtnGap, { borderColor: colors.border }]}
            onPress={removeHero}
            disabled={loading}
            activeOpacity={0.8}
            hitSlop={HERO_BTN_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Remove hero photo"
            testID="ai-photography-remove-hero"
          >
            <Icon name="x" size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      )}
      {mode === 'outfitSwap' && heroPhoto && heroLocked && (
        <View style={[styles.lockedHeroTray, { backgroundColor: colors.card, borderColor: colors.primary }]}>
          <CachedImage source={{ uri: heroPhoto.uri }} style={styles.trayThumb} contentFit="cover" />
          <View style={styles.lockedHeroCopy}>
            <Text style={[styles.lockedHeroTitle, { color: colors.foreground }]}>Hero locked</Text>
            <Text style={[styles.lockedHeroSub, { color: colors.mutedForeground }]}>Same model, pose and scene</Text>
          </View>
          <TouchableOpacity
            style={[styles.resetHeroBtn, { borderColor: colors.border }]}
            onPress={resetOutfitSwap}
            activeOpacity={0.8}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel="Start a new Outfit Swap"
            accessibilityHint="Releases this hero photo so you can lock a different scene"
          >
            <Icon name="rotate-ccw" size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      )}
      {((mode === 'free' && photos.length > 0) || (mode === 'outfitSwap' && garments.length > 0)) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}
        >
          {(mode === 'free' ? photos : garments).map((p) => (
            <View key={p.id} style={styles.trayThumbWrap}>
              <CachedImage source={{ uri: p.uri }} style={styles.trayThumb} contentFit="cover" />
              <TouchableOpacity
                style={[styles.trayRemove, { backgroundColor: colors.destructive }]}
                onPress={() => removePhoto(p.id)}
                disabled={loading}
                activeOpacity={0.8}
                testID={`ai-photography-remove-${p.id}`}
                hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
                accessibilityRole="button"
                accessibilityLabel="Remove photo"
              >
                <Icon name="x" size={11} color={colors.destructiveForeground} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Input */}
      <Composer
        testID="ai-photography"
        value={input}
        onChangeText={setInput}
        onSend={() => sendMessage(input)}
        canSend={(mode === 'free' ? photos.length > 0 : !!heroPhoto) && !loading}
        editable={!loading}
        maxLength={500}
        enterToSend={false}
        placeholder={mode === 'outfitSwap' ? 'Add outfit notes (optional)...' : 'Describe the shot you want...'}
        leftAccessory={
          <TouchableOpacity
            onPress={() => { void pickPhotos(); }}
            activeOpacity={0.8}
            disabled={(mode === 'free' ? photos.length >= MAX_PHOTOS : (heroPhoto ? garments.length >= MAX_GARMENTS : false)) || loading}
            style={styles.attachBtn}
            hitSlop={ATTACH_BTN_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Add photos"
            testID="ai-photography-attach"
          >
            <Icon
              name="camera"
              size={20}
              color={(mode === 'free' ? photos.length >= MAX_PHOTOS : (heroPhoto ? garments.length >= MAX_GARMENTS : false))
                ? colors.mutedForeground
                : colors.primary}
            />
          </TouchableOpacity>
        }
      />
    </KeyboardAvoidingView>
  );
}

// Mode chips draw at 34pt tall (10pt row padding above/below) and the attach
// button at 40×40 — hitSlop pads both to 44pt without changing the layout.
const MODE_CHIP_HIT_SLOP = minHitSlop({ height: 34 });
const ATTACH_BTN_HIT_SLOP = minHitSlop({ width: 40, height: 40 });
const HERO_BTN_HIT_SLOP = minHitSlop({ width: 32, height: 32 });

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  modeSwitch: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  modeChip: { flex: 1, flexBasis: 0, minWidth: 0, minHeight: 40, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  modeChipText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  outfitNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: 1 },
  outfitNoticeText: { flex: 1, fontSize: FS.meta, fontFamily: FONT.regular, lineHeight: 16 },
  // Narrow enough that the badge never eats into the title's available
  // width — a wider badge here previously clipped "AI Product Photography"
  // (251px of text in a 246px box) once the header row split the space.
  bubble: { maxWidth: '85%', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
  attachedRow: { flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  attachedItem: { alignItems: 'center', gap: 3 },
  attachedThumb: { width: 48, height: 48, borderRadius: 8 },
  attachedLabel: { fontSize: FS.xs, fontFamily: FONT.medium },
  resultImage: { width: 240, height: 240, borderRadius: 8, marginTop: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 7, height: 7, borderRadius: 3.5, opacity: 0.6 },
  loadingText: { fontSize: FS.sm, fontFamily: FONT.regular },
  elapsedText: { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 6 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 34, marginTop: 10, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1 },
  trayThumbWrap: { position: 'relative' },
  trayThumb: { width: 56, height: 56, borderRadius: 8 },
  lockedHeroTray: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, padding: 8, borderRadius: 12, borderWidth: 1 },
  lockedHeroCopy: { flex: 1, marginLeft: 10 },
  lockedHeroTitle: { fontSize: FS.meta, fontFamily: FONT.semibold },
  lockedHeroSub: { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 2 },
  heroBtnGap: { marginLeft: 12 },
  resetHeroBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  trayRemove: {
    position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  attachBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, justifyContent: 'center' },
});

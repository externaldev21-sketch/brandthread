/**
 * Brandthread AI Brain Screen — Canonical Chat UI
 *
 * Opens with a single greeting message and an empty composer.
 * No auto-send, no priority list, no fake business fallbacks.
 *
 * Message ownership:
 *  - The SERVICE creates user + assistant messages.
 *  - The UI only shows a temporary streaming indicator (not persisted).
 *  - This eliminates the duplicate-message defect.
 *
 * This screen is an immersive full-screen takeover (see the deny-list entry
 * in app/_layout.tsx) — the floating seller tab bar never renders underneath
 * it, so the composer, suggestions and messages never fight it for space or
 * the keyboard. All bottom spacing here answers only to the safe-area home
 * indicator inset, never the tab bar's own metrics.
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  Animated,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from 'react-native-reanimated';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import AuroraGlow from '@/components/ai/AuroraGlow';
import AiComposer from '@/components/ai/AiComposer';
import MarkdownLite from '@/components/ai/MarkdownLite';
import { useColors } from '@/hooks/useColors';
import {
  AIScreenContext,
  AIMessage,
  AISession,
  SCREEN_PROMPTS,
  contextLabel,
} from '@/services/aiTypes';
import {
  sendMessage,
  sendMessageStream,
  cancelGeneration,
  loadSession,
  startNewSession,
  clearSession,
  applyAction,
  undoAction,
} from '@/services/aiService';
import { getStoreContext } from '@/lib/api';
import { isPreviewCatalogEnabled } from '@/lib/previewCatalog';
import {
  FONT,
  FS,
  SP,
  RADIUS,
  BREAKPOINT,
} from '@/lib/theme';

// ─── Error copy ────────────────────────────────────────────────────────────────

/** Maps raw errors from services/aiService.ts to human copy. Never show server/vendor text. */
function humanizeAiError(rawMessage?: string): string {
  const msg = rawMessage ?? '';
  if (/sign in to use brandthread ai|authentication error/i.test(msg)) {
    return 'Sign in to use Brandthread AI.';
  }
  if (/rate limit reached/i.test(msg)) {
    return "You're sending fast — try again in a minute.";
  }
  // Covers "AI service is not configured…", "AI request failed (…)." and any other
  // network / provider / unavailable error.
  return "Couldn't reach Brandthread AI. Tap Retry.";
}

// ─── Streaming Dots ────────────────────────────────────────────────────────────

function StreamingDots({ accentColor }: { accentColor: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reduceMotion = useReducedMotion();
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const makePulse = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ]),
      );

    const a1 = makePulse(dot1, 0);
    const a2 = makePulse(dot2, 150);
    const a3 = makePulse(dot3, 300);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3, reduceMotion]);

  return (
    <View style={styles.dotsRow}>
      {[dot1, dot2, dot3].map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: accentColor },
            reduceMotion ? { opacity: 0.7 } : { opacity: anim },
          ]}
        />
      ))}
    </View>
  );
}

// ─── Action Card ──────────────────────────────────────────────────────────────

interface ActionCardProps {
  msg: AIMessage;
  onApply: (msgId: string) => void;
  onDismiss: (msgId: string) => void;
  onUndo: (msgId: string) => void;
}

function ActionCardView({ msg, onApply, onDismiss, onUndo }: ActionCardProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const card = msg.actionCard;
  if (!card) return null;
  const { status } = card;

  return (
    <View style={styles.actionCard}>
      <View style={[styles.actionBadge, { backgroundColor: `${colors.primary}22` }]}>
        <Text style={[styles.actionBadgeText, { color: colors.primary }]}>{card.type.toUpperCase()}</Text>
      </View>
      <Text style={styles.actionTitle}>{card.title}</Text>
      <Text style={styles.actionDesc}>{card.description}</Text>
      {card.impact ? <Text style={[styles.actionImpact, { color: colors.primary }]}>Expected: {card.impact}</Text> : null}

      {status === 'pending' && (
        <View style={styles.actionBtns}>
          <TouchableOpacity
            style={styles.actionApplyWrap}
            onPress={() => onApply(msg.id)}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[colors.primary, colors.accentForeground]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.actionApplyGrad}
            >
              <Text style={styles.actionApplyText}>Apply</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionDismissBtn}
            onPress={() => onDismiss(msg.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionDismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'applied' && (
        <View style={styles.actionAppliedRow}>
          <Feather name="check-circle" size={14} color={colors.success} />
          <Text style={styles.actionAppliedText}>Applied</Text>
          {card.canUndo && (
            <TouchableOpacity onPress={() => onUndo(msg.id)} activeOpacity={0.7}>
              <Text style={styles.actionUndoText}>Undo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {(status === 'rejected' || status === 'undone') && (
        <Text style={styles.actionStatusText}>
          {status === 'rejected' ? 'Dismissed' : 'Undone'}
        </Text>
      )}
    </View>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: AIMessage;
  onLongPress: (msg: AIMessage) => void;
  onCopy: (msg: AIMessage) => void;
  onRetry: (originalText: string) => void;
  onApply: (msgId: string) => void;
  onDismiss: (msgId: string) => void;
  onUndo: (msgId: string) => void;
  /** The user message that preceded this assistant message (for retry). */
  precedingUserText?: string;
}

function MessageBubble({
  msg,
  onLongPress,
  onCopy,
  onRetry,
  onApply,
  onDismiss,
  onUndo,
  precedingUserText,
}: MessageBubbleProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();

  if (msg.role === 'user') {
    return (
      <View style={styles.userRow}>
        <LinearGradient
          colors={[colors.primary, colors.accentForeground]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.userBubble}
        >
          <Text style={styles.userText}>{msg.content}</Text>
        </LinearGradient>
      </View>
    );
  }

  // Assistant bubble
  const hasError = !!msg.error;
  const isStreaming = !!msg.isStreaming;
  const showActions = !isStreaming && !hasError && !!msg.content;

  return (
    <Pressable
      onLongPress={() => onLongPress(msg)}
      delayLongPress={400}
      style={styles.assistantRow}
    >
      <BrandthreadLogo size={18} style={styles.assistantAvatar} />
      <View style={styles.assistantBubbleCol}>
        <View style={[styles.assistantBubble, hasError && styles.assistantBubbleError]}>
          {isStreaming ? (
            <StreamingDots accentColor={colors.primary} />
          ) : hasError ? (
            <View>
              <Text style={styles.errorText}>{msg.error}</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => onRetry(precedingUserText ?? '')}
                activeOpacity={0.7}
              >
                <Feather name="refresh-cw" size={13} color={colors.destructive} />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <MarkdownLite text={msg.content} textColor={colors.text} />
          )}
        </View>

        {showActions && msg.sources && msg.sources.length > 0 && (
          <View style={styles.sourcesRow}>
            {msg.sources.map((source) => (
              <TouchableOpacity
                key={source.route}
                style={[styles.sourceChip, { borderColor: colors.border }]}
                onPress={() => router.push(source.route as any)}
                activeOpacity={0.7}
              >
                <Feather name="link" size={11} color={colors.primary} />
                <Text style={[styles.sourceChipText, { color: colors.primary }]} numberOfLines={1}>
                  {source.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {showActions && (
          <View style={styles.msgActionRow}>
            <TouchableOpacity
              style={styles.msgActionBtn}
              onPress={() => onCopy(msg)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityLabel="Copy message"
            >
              <Feather name="copy" size={13} color={colors.subtle} />
              <Text style={styles.msgActionText}>Copy</Text>
            </TouchableOpacity>
            {precedingUserText ? (
              <TouchableOpacity
                style={styles.msgActionBtn}
                onPress={() => onRetry(precedingUserText)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityLabel="Regenerate response"
              >
                <Feather name="refresh-cw" size={13} color={colors.subtle} />
                <Text style={styles.msgActionText}>Regenerate</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {!isStreaming && !hasError && msg.actionCard && (
          <ActionCardView
            msg={msg}
            onApply={onApply}
            onDismiss={onDismiss}
            onUndo={onUndo}
          />
        )}
      </View>
    </Pressable>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  context: AIScreenContext;
  onPillPress: (text: string) => void;
  accentColor: string;
  isTablet: boolean;
}

function EmptyState({ context, onPillPress, accentColor, isTablet }: EmptyStateProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const prompts =
    SCREEN_PROMPTS[context.screen as keyof typeof SCREEN_PROMPTS] ??
    SCREEN_PROMPTS['home'] ??
    [];
  const pills = prompts.slice(0, 4);

  return (
    <View style={[styles.emptyState, isTablet && styles.emptyStateTablet]}>
      <BrandthreadLogo size={isTablet ? 64 : 52} showGlow glowColor={accentColor} animated />
      <Text style={styles.emptyTitle}>What are we building today?</Text>
      <Text style={styles.emptySubtitle}>
        Ask about your brand, products, content, store, or performance.
      </Text>
      <View style={styles.pillGrid}>
        {pills.map((prompt, i) => (
          <TouchableOpacity
            key={i}
            style={styles.pill}
            onPress={() => onPillPress(prompt)}
            activeOpacity={0.75}
          >
            <Text style={styles.pillText}>{prompt}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

/**
 * A transient assistant typing indicator shown while the request is in flight.
 * This is NEVER persisted as a message. It disappears when the response arrives
 * or the request fails.
 */
function TypingIndicator({ accentColor, streamingText }: { accentColor: string; streamingText?: string }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.assistantRow}>
      <BrandthreadLogo size={18} style={styles.assistantAvatar} />
      <View style={styles.assistantBubbleCol}>
        <View style={styles.assistantBubble}>
          {streamingText ? (
            <MarkdownLite text={streamingText} textColor={colors.text} />
          ) : (
            <StreamingDots accentColor={accentColor} />
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

/** One greeting shown on every fresh session open. Never auto-sends. */
const GREETING: AIMessage = {
  id: '__greeting__',
  role: 'assistant',
  content: 'Hi — how can I help?',
  ts: 0,
};

export default function AiBrainScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isTablet = width >= BREAKPOINT.tablet;
  const { getToken, userId, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const params = useLocalSearchParams<{ context?: string }>();

  const parsedContext: AIScreenContext = useMemo(() => {
    try {
      return JSON.parse(params.context ?? '{"screen":"general"}') as AIScreenContext;
    } catch {
      return { screen: 'general' };
    }
  }, [params.context]);

  const storeContext = getStoreContext();

  const [session, setSession] = useState<AISession | null>(null);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  /**
   * When a request fails we keep the error alongside the preserved input
   * so the user can retry without retyping.
   */
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingRetryText, setPendingRetryText] = useState<string>('');
  const [streamingText, setStreamingText] = useState<string>('');

  const flatListRef = useRef<FlatList<AIMessage>>(null);

  // Track the last user/store context so we can reload on switch.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  const lastStoreContextRef = useRef<string | null>(null);

  // ─── Load session ───────────────────────────────────────────────────────────

  useEffect(() => {
    const userChanged = lastUserIdRef.current !== userId;
    const storeChanged = lastStoreContextRef.current !== storeContext;

    if (userChanged || storeChanged || session === null) {
      lastUserIdRef.current = userId;
      lastStoreContextRef.current = storeContext;
      loadSession(parsedContext, userId, storeContext).then(s => setSession(s));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, storeContext]);

  // ─── Dismiss error on new input ─────────────────────────────────────────────

  useEffect(() => {
    if (inputText.trim() && errorMsg) {
      setErrorMsg(null);
    }
  }, [inputText, errorMsg]);

  // ─── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (override?: string) => {
      const text = (override ?? inputText).trim();
      if (!text || isGenerating || !session) return;

      // Clerk hasn't finished hydrating the session yet — this is not the
      // same as "not signed in". Retrying getToken() here would sometimes
      // resolve to null for a genuinely signed-in user and wrongly show the
      // sign-in prompt (the root cause of the "sign in" bug on this screen).
      if (!isAuthLoaded) {
        setErrorMsg("Still preparing your session — tap Retry in a moment.");
        setPendingRetryText(text);
        setInputText(text);
        return;
      }

      if (!isSignedIn) {
        setErrorMsg('Sign in to use Brandthread AI.');
        setPendingRetryText(text);
        setInputText(text);
        return;
      }

      setInputText('');
      setErrorMsg(null);
      setPendingRetryText(text);
      setIsGenerating(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const token = await getToken().catch(() => null);

      // The user IS signed in (checked above) — a null token here means the
      // token fetch itself failed (network/refresh), not that they're
      // signed out. Surface that distinction instead of collapsing both
      // cases into the same "sign in" message.
      if (!token) {
        setErrorMsg("Couldn't verify your session. Tap Retry.");
        setInputText(text);
        setIsGenerating(false);
        return;
      }

      setStreamingText('');
      try {
        const result = await sendMessageStream(
          { userText: text, session, authToken: token, userId, storeContext },
          (textSoFar) => setStreamingText(textSoFar),
        );
        setSession(result.session);
      } catch (err: unknown) {
        const isAbort = (err as Error)?.name === 'AbortError';
        if (!isAbort) {
          setErrorMsg(humanizeAiError((err as Error)?.message));
          // Restore user text so they can retry without retyping.
          setInputText(text);
        }
      } finally {
        setIsGenerating(false);
        setStreamingText('');
      }
    },
    [inputText, isGenerating, session, getToken, userId, storeContext, isAuthLoaded, isSignedIn],
  );

  // ─── Pill tap (populates composer only — user taps send) ────────────────────

  const handlePillPress = useCallback((text: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputText(text);
    // Intentionally NOT auto-sending. User reviews and sends.
  }, []);

  // ─── Stop generation ────────────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    cancelGeneration();
    setIsGenerating(false);
    setStreamingText('');
  }, []);

  // ─── Clear session ──────────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    Alert.alert(
      'Clear conversation',
      'This will erase all messages in this session.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearSession(userId, storeContext);
            setSession(startNewSession(parsedContext));
            setErrorMsg(null);
            setInputText('');
          },
        },
      ],
    );
  }, [parsedContext, userId, storeContext]);

  // ─── Copy ───────────────────────────────────────────────────────────────────

  const handleCopy = useCallback((msg: AIMessage) => {
    if (!msg.content) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Clipboard.setStringAsync(msg.content);
  }, []);

  // ─── Long press (copy) ──────────────────────────────────────────────────────

  const handleLongPress = useCallback((msg: AIMessage) => {
    if (!msg.content) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Message', undefined, [
      { text: 'Copy', onPress: () => Clipboard.setStringAsync(msg.content) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  // ─── Retry ──────────────────────────────────────────────────────────────────

  const handleRetry = useCallback(
    (originalText: string) => {
      const text = originalText || pendingRetryText;
      if (text) handleSend(text);
    },
    [handleSend, pendingRetryText],
  );

  // ─── Apply / Dismiss / Undo ─────────────────────────────────────────────────

  const handleApply = useCallback(
    (msgId: string) => {
      if (!session) return;
      const msg = session.messages.find(m => m.id === msgId);
      if (!msg?.actionCard) return;

      const doApply = async () => {
        const updated = await applyAction(session, msgId, true, userId, storeContext);
        setSession({ ...updated });
      };

      if (msg.actionCard.isDestructive) {
        Alert.alert(
          'Apply action',
          `Are you sure you want to apply "${msg.actionCard.title}"? This action is irreversible.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Apply', style: 'destructive', onPress: doApply },
          ],
        );
      } else {
        doApply();
      }
    },
    [session, userId, storeContext],
  );

  const handleDismiss = useCallback(
    async (msgId: string) => {
      if (!session) return;
      const updated = await applyAction(session, msgId, false, userId, storeContext);
      setSession({ ...updated });
    },
    [session, userId, storeContext],
  );

  const handleUndo = useCallback(
    async (msgId: string) => {
      if (!session) return;
      const updated = await undoAction(session, msgId, userId, storeContext);
      setSession({ ...updated });
    },
    [session, userId, storeContext],
  );

  // ─── Build display list ─────────────────────────────────────────────────────

  /**
   * The display list is:
   *   [greeting, ...session.messages]
   *
   * The greeting is a synthetic message that never appears in the persisted
   * session. It is always shown so the screen never opens blank.
   * FlatList is inverted, so items are reversed for rendering.
   */
  const sessionMessages = session?.messages ?? [];
  const allMessages: AIMessage[] = [GREETING, ...sessionMessages];

  // Build a map from assistant-message id → preceding user text for retry.
  const precedingUserTextMap = useMemo(() => {
    const map = new Map<string, string>();
    for (let i = 0; i < sessionMessages.length; i++) {
      const m = sessionMessages[i];
      if (m.role === 'assistant') {
        // Look backward for the most recent user message.
        for (let j = i - 1; j >= 0; j--) {
          if (sessionMessages[j].role === 'user') {
            map.set(m.id, sessionMessages[j].content);
            break;
          }
        }
      }
    }
    return map;
  }, [sessionMessages]);

  // ─── Render message ─────────────────────────────────────────────────────────

  const renderMessage = useCallback(
    ({ item }: { item: AIMessage }) => (
      <MessageBubble
        msg={item}
        onLongPress={handleLongPress}
        onCopy={handleCopy}
        onRetry={handleRetry}
        onApply={handleApply}
        onDismiss={handleDismiss}
        onUndo={handleUndo}
        precedingUserText={precedingUserTextMap.get(item.id)}
      />
    ),
    [handleLongPress, handleCopy, handleRetry, handleApply, handleDismiss, handleUndo, precedingUserTextMap],
  );

  const label = contextLabel(parsedContext);
  const canSend = inputText.trim().length > 0 && !isGenerating;
  // Home-indicator-safe bottom padding. The tab bar never renders on this
  // screen (see the full-screen deny-list in app/_layout.tsx), so this is
  // the only bottom inset the composer needs to clear.
  const composerBottomInset = Math.max(insets.bottom, 8);

  return (
    <View style={styles.root}>
      <AuroraGlow thinking={isGenerating} />

      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={20} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <BrandthreadLogo size={18} />
            <Text style={styles.headerLabel} numberOfLines={1}>{label}</Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={handleClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="rotate-ccw" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerBtn, { marginLeft: 4 }]}
              onPress={() => router.push('/ai-settings' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="sliders" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {errorMsg ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={14} color={colors.destructive} style={{ marginRight: 6 }} />
            <Text style={styles.errorBannerText} numberOfLines={2}>{errorMsg}</Text>
            <TouchableOpacity
              onPress={() => handleRetry(pendingRetryText)}
              style={styles.retryBannerBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.retryBannerText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Signed-out gate ─────────────────────────────────────────────────
            Only shown once Clerk has actually finished loading AND
            confirmed there's no session — never during the brief hydration
            window, which is what previously caused this screen to show a
            false "sign in" prompt for already-signed-in sellers. */}
        {isAuthLoaded && !isSignedIn && !isPreviewCatalogEnabled() ? (
          <View style={styles.signInGate}>
            <Feather name="lock" size={28} color={colors.mutedForeground} />
            <Text style={styles.signInGateTitle}>Sign in to use Brandthread AI</Text>
            <Text style={styles.signInGateBody}>
              Brandthread AI reads your store's live data to answer questions — sign in to start chatting.
            </Text>
            <TouchableOpacity
              style={[styles.signInGateBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/sign-in' as any)}
              activeOpacity={0.85}
            >
              <Text style={[styles.signInGateBtnText, { color: colors.primaryForeground }]}>Sign in</Text>
            </TouchableOpacity>
          </View>
        ) : isAuthLoaded && !isSignedIn ? (
          // Preview/dev mode: explorable demo instead of a hard sign-in wall.
          // Real signed-out production behavior above is unchanged.
          <View style={styles.signInGate}>
            <Feather name="cpu" size={28} color={colors.mutedForeground} />
            <Text style={styles.signInGateTitle}>Brandthread AI — preview</Text>
            <Text style={styles.signInGateBody}>
              In the live app, Brandthread AI reads your store's real sales, orders and inventory to answer
              questions like "What's my best seller this week?" or "Draft a restock reminder for low-stock items."
              Sign in on a real account to chat with your own data.
            </Text>
            <TouchableOpacity
              style={[styles.signInGateBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/sign-in' as any)}
              activeOpacity={0.85}
            >
              <Text style={[styles.signInGateBtnText, { color: colors.primaryForeground }]}>Sign in</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ── Message list ────────────────────────────────────────────── */}
            <FlatList
              ref={flatListRef}
              data={[...allMessages].reverse()}
              keyExtractor={m => m.id}
              renderItem={renderMessage}
              inverted
              contentContainerStyle={[
                styles.listContent,
                isTablet && styles.listContentTablet,
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={isGenerating ? (
                <TypingIndicator accentColor={colors.primary} streamingText={streamingText} />
              ) : null}
              ListFooterComponent={
                sessionMessages.length === 0 ? (
                  <View style={styles.emptyWrapper}>
                    <EmptyState
                      context={parsedContext}
                      onPillPress={handlePillPress}
                      accentColor={colors.primary}
                      isTablet={isTablet}
                    />
                  </View>
                ) : null
              }
            />

            {/* ── Input row ───────────────────────────────────────────────── */}
            <AiComposer
              value={inputText}
              onChangeText={setInputText}
              onSend={() => handleSend()}
              onStop={handleStop}
              isGenerating={isGenerating}
              canSend={canSend}
              placeholder={isAuthLoaded ? 'Ask anything about your brand…' : 'Preparing your session…'}
              accentColor={colors.primary}
              bottomInset={composerBottomInset}
            />
          </>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  kav: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    minHeight: 56,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: SP.sm,
  },
  headerLabel: {
    color: colors.mutedForeground,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // ── Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${colors.destructive}22`,
    borderBottomWidth: 1,
    borderBottomColor: colors.destructive,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  errorBannerText: {
    flex: 1,
    color: colors.destructive,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    lineHeight: 18,
  },
  retryBannerBtn: {
    marginLeft: SP.sm,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
  },
  retryBannerText: {
    color: colors.destructive,
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
  },

  // ── Signed-out gate
  signInGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xl,
    gap: SP.sm,
  },
  signInGateTitle: {
    color: colors.text,
    fontSize: FS.lg,
    fontFamily: FONT.semibold,
    marginTop: SP.sm,
    textAlign: 'center',
  },
  signInGateBody: {
    color: colors.mutedForeground,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SP.sm,
  },
  signInGateBtn: {
    paddingHorizontal: SP.xl,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.lg,
  },
  signInGateBtnText: {
    fontSize: FS.md,
    fontFamily: FONT.semibold,
  },

  // ── Message list
  listContent: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    gap: 12,
  },
  listContentTablet: {
    paddingHorizontal: SP.xl,
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },

  // ── Empty state
  emptyWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
    paddingVertical: SP.xl,
  },
  emptyState: {
    alignItems: 'center',
    width: '100%',
  },
  emptyStateTablet: {
    maxWidth: 480,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: FS.xl,
    fontFamily: FONT.semibold,
    textAlign: 'center',
    marginTop: SP.md,
    marginBottom: SP.xs,
  },
  emptySubtitle: {
    color: colors.mutedForeground,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SP.lg,
  },
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
    justifyContent: 'center',
    width: '100%',
  },
  pill: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    maxWidth: '47%',
  },
  pillText: {
    color: colors.mutedForeground,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    textAlign: 'center',
  },

  // ── User bubble
  userRow: {
    alignItems: 'flex-end',
    marginVertical: 4,
  },
  userBubble: {
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    maxWidth: '75%',
  },
  userText: {
    color: colors.primaryForeground,
    fontSize: FS.base,
    fontFamily: FONT.medium,
  },

  // ── Assistant bubble
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 4,
  },
  assistantAvatar: {
    marginTop: 4,
    marginRight: 8,
  },
  assistantBubbleCol: {
    flex: 1,
    maxWidth: '80%',
  },
  assistantBubble: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  assistantBubbleError: {
    borderColor: colors.destructive,
  },

  // ── Message actions (copy / regenerate)
  sourcesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  sourceChipText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  msgActionRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 6,
    paddingLeft: 4,
  },
  msgActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  msgActionText: {
    color: colors.subtle,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },

  // ── Streaming dots
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  // ── Error / retry
  errorText: {
    color: colors.destructive,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    lineHeight: 22,
    marginBottom: 6,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  retryText: {
    color: colors.destructive,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },

  // ── Action card
  actionCard: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
  },
  actionBadge: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.xs,
    paddingVertical: 2,
    paddingHorizontal: 7,
    marginBottom: 8,
  },
  actionBadgeText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
  },
  actionTitle: {
    color: colors.text,
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    marginBottom: 4,
  },
  actionDesc: {
    color: colors.mutedForeground,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    lineHeight: 19,
  },
  actionImpact: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    marginTop: 6,
  },
  actionBtns: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionApplyWrap: {
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  actionApplyGrad: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionApplyText: {
    color: colors.primaryForeground,
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
  },
  actionDismissBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  actionDismissText: {
    color: colors.mutedForeground,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  actionAppliedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  actionAppliedText: {
    color: colors.success,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    flex: 1,
  },
  actionUndoText: {
    color: colors.mutedForeground,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  actionStatusText: {
    color: colors.subtle,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    marginTop: 8,
  },
});

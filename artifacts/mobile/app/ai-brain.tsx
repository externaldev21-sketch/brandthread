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
  cancelGeneration,
  loadSession,
  startNewSession,
  clearSession,
  applyAction,
  undoAction,
} from '@/services/aiService';
import { getStoreContext } from '@/lib/api';
import {
  CARD,
  CARD_ELEVATED,
  BORDER,
  BORDER_ACTIVE,
  FG,
  MUTED,
  SUBTLE,
  SUCCESS,
  RED,
  RED_DIM,
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
          <Feather name="check-circle" size={14} color={SUCCESS} />
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
                <Feather name="refresh-cw" size={13} color={RED} />
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <MarkdownLite text={msg.content} textColor={FG} />
          )}
        </View>

        {showActions && (
          <View style={styles.msgActionRow}>
            <TouchableOpacity
              style={styles.msgActionBtn}
              onPress={() => onCopy(msg)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityLabel="Copy message"
            >
              <Feather name="copy" size={13} color={SUBTLE} />
              <Text style={styles.msgActionText}>Copy</Text>
            </TouchableOpacity>
            {precedingUserText ? (
              <TouchableOpacity
                style={styles.msgActionBtn}
                onPress={() => onRetry(precedingUserText)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityLabel="Regenerate response"
              >
                <Feather name="refresh-cw" size={13} color={SUBTLE} />
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
function TypingIndicator({ accentColor }: { accentColor: string }) {
  return (
    <View style={styles.assistantRow}>
      <BrandthreadLogo size={18} style={styles.assistantAvatar} />
      <View style={styles.assistantBubbleCol}>
        <View style={styles.assistantBubble}>
          <StreamingDots accentColor={accentColor} />
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isTablet = width >= BREAKPOINT.tablet;
  const { getToken, userId } = useAuth();
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

      setInputText('');
      setErrorMsg(null);
      setPendingRetryText(text);
      setIsGenerating(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const token = await getToken().catch(() => null);

      try {
        const result = await sendMessage({
          userText: text,
          session,
          authToken: token,
          userId,
          storeContext,
        });
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
      }
    },
    [inputText, isGenerating, session, getToken, userId, storeContext],
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
            <Feather name="x" size={20} color={FG} />
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
              <Feather name="rotate-ccw" size={18} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.headerBtn, { marginLeft: 4 }]}
              onPress={() => router.push('/ai-settings' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="sliders" size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {errorMsg ? (
          <View style={styles.errorBanner}>
            <Feather name="alert-circle" size={14} color={RED} style={{ marginRight: 6 }} />
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

        {/* ── Message list ────────────────────────────────────────────────── */}
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
          ListHeaderComponent={isGenerating ? <TypingIndicator accentColor={colors.primary} /> : null}
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

        {/* ── Input row ───────────────────────────────────────────────────── */}
        <AiComposer
          value={inputText}
          onChangeText={setInputText}
          onSend={() => handleSend()}
          onStop={handleStop}
          isGenerating={isGenerating}
          canSend={canSend}
          placeholder="Ask anything about your brand…"
          accentColor={colors.primary}
          bottomInset={composerBottomInset}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0B',
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
    borderBottomColor: BORDER,
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
    color: MUTED,
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
    backgroundColor: RED_DIM,
    borderBottomWidth: 1,
    borderBottomColor: RED,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  errorBannerText: {
    flex: 1,
    color: RED,
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
    color: RED,
    fontSize: FS.sm,
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
    color: FG,
    fontSize: FS.xl,
    fontFamily: FONT.semibold,
    textAlign: 'center',
    marginTop: SP.md,
    marginBottom: SP.xs,
  },
  emptySubtitle: {
    color: MUTED,
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
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    maxWidth: '47%',
  },
  pillText: {
    color: MUTED,
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
    color: '#FFFFFF',
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
    borderColor: BORDER,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  assistantBubbleError: {
    borderColor: RED,
  },

  // ── Message actions (copy / regenerate)
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
    color: SUBTLE,
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
    color: RED,
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
    color: RED,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },

  // ── Action card
  actionCard: {
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
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
    color: FG,
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    marginBottom: 4,
  },
  actionDesc: {
    color: MUTED,
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
    color: '#FFFFFF',
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
  },
  actionDismissBtn: {
    flex: 1,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  actionDismissText: {
    color: MUTED,
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
    color: SUCCESS,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    flex: 1,
  },
  actionUndoText: {
    color: MUTED,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  actionStatusText: {
    color: SUBTLE,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    marginTop: 8,
  },
});

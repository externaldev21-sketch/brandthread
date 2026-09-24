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
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
  Animated,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth, useUser } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
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
  BG,
  SURFACE,
  CARD,
  CARD_ELEVATED,
  BORDER,
  BORDER_ACTIVE,
  FG,
  MUTED,
  SUBTLE,
  PURPLE,
  PURPLE_DIM,
  CYAN,
  SUCCESS,
  RED,
  RED_DIM,
  FONT,
  FS,
  SP,
  RADIUS,
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

function StreamingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
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
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.dotsRow}>
      {[dot1, dot2, dot3].map((anim, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: anim }]} />
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
      <View style={styles.actionBadge}>
        <Text style={styles.actionBadgeText}>{card.type.toUpperCase()}</Text>
      </View>
      <Text style={styles.actionTitle}>{card.title}</Text>
      <Text style={styles.actionDesc}>{card.description}</Text>
      {card.impact ? <Text style={styles.actionImpact}>Expected: {card.impact}</Text> : null}

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
            <StreamingDots />
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
            <Text style={styles.assistantText}>{msg.content}</Text>
          )}
        </View>

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
}

function EmptyState({ context, onPillPress }: EmptyStateProps) {
  const colors = useColors();
  const prompts =
    SCREEN_PROMPTS[context.screen as keyof typeof SCREEN_PROMPTS] ??
    SCREEN_PROMPTS['home'] ??
    [];
  const pills = prompts.slice(0, 4);

  return (
    <View style={styles.emptyState}>
      <BrandthreadLogo size={48} showGlow glowColor={colors.primary} animated />
      <Text style={styles.emptyTitle}>Ask Brandthread AI</Text>
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
function TypingIndicator() {
  return (
    <View style={styles.assistantRow}>
      <BrandthreadLogo size={18} style={styles.assistantAvatar} />
      <View style={styles.assistantBubbleCol}>
        <View style={styles.assistantBubble}>
          <StreamingDots />
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
        onRetry={handleRetry}
        onApply={handleApply}
        onDismiss={handleDismiss}
        onUndo={handleUndo}
        precedingUserText={precedingUserTextMap.get(item.id)}
      />
    ),
    [handleLongPress, handleRetry, handleApply, handleDismiss, handleUndo, precedingUserTextMap],
  );

  const label = contextLabel(parsedContext);
  const canSend = inputText.trim().length > 0 && !isGenerating;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: 'transparent' }]}
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
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={isGenerating ? <TypingIndicator /> : null}
        ListFooterComponent={
          sessionMessages.length === 0 ? (
            <View style={styles.emptyWrapper}>
              <EmptyState context={parsedContext} onPillPress={handlePillPress} />
            </View>
          ) : null
        }
      />

      {/* ── Input row ───────────────────────────────────────────────────── */}
      <View style={[styles.inputRow, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask anything about your brand…"
          placeholderTextColor={SUBTLE}
          multiline
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => {
            if (canSend) handleSend();
          }}
        />

        {isGenerating ? (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={handleStop}
            activeOpacity={0.8}
          >
            <Feather name="square" size={20} color={RED} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={() => handleSend()}
            disabled={!canSend}
            activeOpacity={0.8}
          >
            <Feather
              name="send"
              size={20}
              color={canSend ? colors.primary : MUTED}
            />
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  // ── Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderBottomWidth: 1,
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
    backgroundColor: CARD,
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
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  assistantBubbleError: {
    borderColor: RED,
  },
  assistantText: {
    color: FG,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    lineHeight: 22,
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
    backgroundColor: PURPLE,
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
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.xs,
    paddingVertical: 2,
    paddingHorizontal: 7,
    marginBottom: 8,
  },
  actionBadgeText: {
    color: PURPLE,
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
    color: CYAN,
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

  // ── Input row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
  },
  textInput: {
    flex: 1,
    color: FG,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    backgroundColor: CARD,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

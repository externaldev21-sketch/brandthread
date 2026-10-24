import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
} from 'react-native';
import { CachedImage } from '@/components/CachedImage';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AiGeneratedBadge } from '@/components/AiGeneratedBadge';
import Composer from '@/components/ui/Composer';
import { Button } from '@/components/ui/Button';
import { AddToProductSheet } from '@/components/ai/AddToProductSheet';
import { aiToolErrorMessage } from '@/components/ai-tools/aiToolErrorMessage';
import { useApi } from '@/hooks/useApi';
import { haptics } from '@/lib/haptics';
import { showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import {
  addGeneratedImageToProduct,
  saveGeneratedImage,
  shareGeneratedImage,
} from '@/lib/generatedImageActions';
import type { Product } from '@/services/productTypes';
import { FONT, FS } from '@/lib/theme';
import { radius } from '@/constants/radii';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string; // base64
  error?: boolean;
  /** On a failed generation: the prompt Retry re-sends. */
  retryPrompt?: string;
}

const SUGGESTED = [
  'Minimalist hoodie, chest wordmark',
  'Streetwear tee, bold back graphic',
  'Cropped jacket, embroidered sleeve logo',
];

const INITIAL_MSG: Message = {
  id: '0',
  role: 'assistant',
  content: "Describe the garment, your brand and the design — I'll turn it into a photo-real mockup.",
};

export default function AIMockupChatScreen() {
  const colors = useColors();
  const api = useApi();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatRef = useRef<FlatList>(null);
  // Actions under a generated mockup (same paths as Lifestyle Images).
  const [savingId, setSavingId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<Message | null>(null);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
    };
    setMessages((prev) => [userMsg, ...prev]);
    setInput('');
    await generate(text.trim());
  }

  /** Re-sends the failed prompt in place of the error bubble (no retyping). */
  async function retry(failed: Message) {
    if (loading || !failed.retryPrompt) return;
    setMessages((prev) => prev.filter((m) => m.id !== failed.id));
    await generate(failed.retryPrompt);
  }

  async function generate(prompt: string) {
    setLoading(true);
    try {
      const result = await api.mockup.generate(prompt);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result?.b64_json
          ? "Here's your mockup — generated from your description."
          : "I couldn't generate that mockup. Please try again with a different description.",
        image: result?.b64_json,
        error: !result?.b64_json,
        retryPrompt: result?.b64_json ? undefined : prompt,
      };
      setMessages((prev) => [aiMsg, ...prev]);
    } catch (err: unknown) {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        // Credits / daily-cap / network copy; a 402 also opens AI credits.
        content: aiToolErrorMessage(err, "Couldn't create that mockup. Please try again."),
        error: true,
        retryPrompt: prompt,
      };
      setMessages((prev) => [aiMsg, ...prev]);
    } finally {
      setLoading(false);
    }
  }

  async function saveMockup(msg: Message) {
    if (!msg.image || savingId) return;
    setSavingId(msg.id);
    try {
      const outcome = await saveGeneratedImage(msg.image, 'mockup');
      if (outcome.ok) {
        haptics.success();
        showAlert('Saved', outcome.message);
      } else {
        showAlert(outcome.title, outcome.message);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function addMockupToProduct(product: Product) {
    const msg = pickerFor;
    setPickerFor(null);
    if (!msg?.image) return;
    setAddingId(msg.id);
    try {
      await addGeneratedImageToProduct(api, product, msg.image, 'mockup');
      haptics.success();
      showAlert('Added', `Added to "${product.name ?? 'product'}" media gallery.`);
    } catch (err) {
      showAlert("Couldn't add to product", friendlyError(err, 'The mockup did not upload. Try again.'));
    } finally {
      setAddingId(null);
    }
  }

  // Suggestions stay until a mockup has actually been generated, so a failed
  // first try (e.g. a tapped suggestion) can be tapped again.
  const showSuggestions = !messages.some((m) => !!m.image);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: 'transparent' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader title="Clothing mockups" divider={false} />

      {/* Messages */}
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
                <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Generating your mockup…</Text>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item: msg }) => (
          <View style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble, {
            backgroundColor: msg.role === 'user' ? colors.primary : colors.card,
            borderColor: msg.role === 'user' ? 'transparent' : (msg.error ? colors.destructive : colors.border),
          }]}>
            <Text style={[styles.bubbleText, { color: msg.role === 'user' ? colors.primaryForeground : colors.foreground }]}>
              {msg.content}
            </Text>
            {msg.image && (
              <View>
                <CachedImage
                  source={{ uri: `data:image/png;base64,${msg.image}` }}
                  style={styles.mockupImage}
                  contentFit="cover"
                />
                <AiGeneratedBadge />
                <View style={styles.imageActions}>
                  <Button
                    label={savingId === msg.id ? 'Saving…' : 'Save'}
                    icon="download"
                    variant="secondary"
                    size="compact"
                    disabled={savingId !== null}
                    onPress={() => { void saveMockup(msg); }}
                    accessibilityLabel="Save mockup"
                  />
                  <Button
                    label="Share"
                    icon="share"
                    variant="secondary"
                    size="compact"
                    onPress={() => { if (msg.image) void shareGeneratedImage(msg.image, 'mockup'); }}
                    accessibilityLabel="Share mockup"
                  />
                  <Button
                    label={addingId === msg.id ? 'Adding…' : 'Add to product'}
                    icon="package"
                    variant="secondary"
                    size="compact"
                    disabled={addingId !== null}
                    onPress={() => setPickerFor(msg)}
                    accessibilityLabel="Add mockup to a product"
                  />
                </View>
              </View>
            )}
            {msg.error && msg.retryPrompt && (
              <Button
                label="Retry"
                icon="refresh-cw"
                variant="secondary"
                size="compact"
                disabled={loading}
                onPress={() => { void retry(msg); }}
                style={styles.retryBtn}
                accessibilityLabel="Retry this mockup"
                testID={`ai-mockup-retry-${msg.id}`}
              />
            )}
          </View>
        )}
      />

      <AddToProductSheet
        visible={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        onPick={(product) => { void addMockupToProduct(product); }}
      />

      {/* Input */}
      <Composer
        testID="ai-mockup"
        value={input}
        onChangeText={setInput}
        onSend={() => sendMessage(input)}
        canSend={!!input.trim() && !loading}
        editable={!loading}
        maxLength={500}
        enterToSend={false}
        placeholder="Describe your design in your own words..."
        topSlot={
          showSuggestions ? (
            <View style={styles.suggestionList}>
              {SUGGESTED.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => sendMessage(s)}
                  disabled={loading}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  style={[styles.suggestion, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.suggestionText, { color: colors.foreground }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bubble: { maxWidth: '85%', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1 },
  userBubble: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 20 },
  mockupImage: { width: 240, height: 240, borderRadius: 8, marginTop: 10 },
  imageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  retryBtn: { alignSelf: 'flex-start', marginTop: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingDots: { flexDirection: 'row', gap: 6 },
  loadDot: { width: 7, height: 7, borderRadius: 3.5, opacity: 0.6 },
  loadingText: { fontSize: FS.sm, fontFamily: FONT.regular },
  suggestionList: { gap: 8, paddingBottom: 8 },
  suggestion: { borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, maxWidth: 220, alignSelf: 'center' },
  suggestionText: { fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 18 },
});

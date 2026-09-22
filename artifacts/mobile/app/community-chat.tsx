import React, { useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FS } from '@/lib/theme';

interface CommunityMessage {
  id: string;
  author: string;
  initial: string;
  color: string;
  text: string;
  time: string;
  fromMe?: boolean;
}

const SEED_MESSAGES: CommunityMessage[] = [
  { id: '1', author: 'Lin W.', initial: 'L', color: '#F472B6', text: "Anyone else's payouts running a day late this week?", time: '9:12 AM' },
  { id: '2', author: 'Sam K.', initial: 'S', color: '#60A5FA', text: 'Mine cleared on time. Might be bank-specific.', time: '9:14 AM' },
  { id: '3', author: 'Alex P.', initial: 'A', color: '#34D399', text: 'Welcome to everyone who joined this week! Introduce your brand below 👇', time: '9:20 AM' },
];

export default function CommunityChatScreen() {
  const colors = useColors();
  const [messages, setMessages] = useState<CommunityMessage[]>(SEED_MESSAGES);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<CommunityMessage>>(null);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleSend() {
    const text = draft.trim();
    if (!text) return;
    haptic();
    const now = new Date();
    const h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    setMessages((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        author: 'You',
        initial: 'Y',
        color: colors.primary,
        text,
        time: `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`,
        fromMe: true,
      },
    ]);
    setDraft('');
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: 'transparent' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Community Chat" subtitle="12,400+ brand founders" />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}
        renderItem={({ item }) => (
          <View style={[styles.msgRow, item.fromMe && styles.msgRowMe]}>
            {!item.fromMe && (
              <View style={[styles.avatar, { backgroundColor: item.color + '2A' }]}>
                <Text style={[styles.avatarText, { color: item.color }]}>{item.initial}</Text>
              </View>
            )}
            <View style={{ flex: 1, alignItems: item.fromMe ? 'flex-end' : 'flex-start' }}>
              {!item.fromMe && (
                <Text style={[styles.author, { color: colors.mutedForeground }]}>{item.author}</Text>
              )}
              <View
                style={[
                  styles.bubble,
                  item.fromMe
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                ]}
              >
                <Text style={[styles.bubbleText, { color: item.fromMe ? colors.primaryForeground : colors.foreground }]}>
                  {item.text}
                </Text>
              </View>
              <Text style={[styles.time, { color: colors.mutedForeground }]}>{item.time}</Text>
            </View>
          </View>
        )}
      />

      <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message the community..."
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
          multiline
        />
        <TouchableOpacity
          onPress={handleSend}
          activeOpacity={0.7}
          disabled={!draft.trim()}
          style={[styles.sendBtn, { backgroundColor: draft.trim() ? colors.primary : colors.secondary }]}
        >
          <Feather name="arrow-up" size={18} color={draft.trim() ? colors.primaryForeground : colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  msgRowMe: { justifyContent: 'flex-end' },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  author: { fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 3 },
  bubble: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '85%' },
  bubbleText: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 19 },
  time: { fontSize: FS.xs, fontFamily: 'Inter_400Regular', marginTop: 4 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, fontFamily: 'Inter_400Regular', maxHeight: 100 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});

import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Dimensions, Alert, Modal, Switch,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, FONT, FS, SP, RADIUS, ICON, GRAD_PRIMARY,
} from '@/lib/theme';
import { createStory, MY_USER_ID, MY_COLOR, MY_INITIALS } from '@/services/socialService';
import type { StoryMedia, StoryPrivacySettings } from '@/services/socialTypes';

const { width: W } = Dimensions.get('window');
const CANVAS_H = Math.min(W * 1.4, 400);

const BG_COLORS = ['#1a1a2e', '#0d1117', '#1a0d1a', '#0d1a2e', '#1a1400', '#2e0d0d'];
const TEXT_COLORS = ['#FFFFFF', '#000000', PURPLE, CYAN, '#F59E0B', '#10B981'];

type MediaType = 'photo' | 'video' | 'text';
type Visibility = 'public' | 'friends';

const TYPE_TABS: { label: string; value: MediaType; icon: string }[] = [
  { label: 'Photo', value: 'photo', icon: 'image' },
  { label: 'Video', value: 'video', icon: 'video' },
  { label: 'Text', value: 'text', icon: 'type' },
];

export default function BuyerStoryCreate() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [type, setType] = useState<MediaType>('text');
  const [bgColor, setBgColor] = useState('#1a1a2e');
  const [textContent, setTextContent] = useState('');
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [privacyVis, setPrivacyVis] = useState<Visibility>('public');
  const [allowReplies, setAllowReplies] = useState(true);
  const [isPosting, setIsPosting] = useState(false);

  const isShareDisabled =
    isPosting || (type === 'text' && textContent.trim().length === 0);

  const doShare = useCallback(async () => {
    if (isShareDisabled) return;
    setIsPosting(true);
    try {
      const mediaId = 'sm_' + Date.now();
      const media: StoryMedia[] = [
        {
          id: mediaId,
          type,
          backgroundColor: bgColor,
          textContent: type === 'text' ? textContent : undefined,
          textColor: type === 'text' ? textColor : undefined,
          duration: 5,
        },
      ];
      const privacy: StoryPrivacySettings = {
        visibility: privacyVis,
        replyPermission: allowReplies ? 'everyone' : 'off',
        hiddenFromUserIds: [],
        closeFriendsOnly: false,
      };
      await createStory({ media, privacy, repliesDisabled: !allowReplies });
      router.back();
    } catch (err) {
      Alert.alert('Error', 'Failed to post story. Please try again.');
    } finally {
      setIsPosting(false);
    }
  }, [isShareDisabled, type, bgColor, textContent, textColor, privacyVis, allowReplies]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Text style={styles.closeText}>×</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Story</Text>
        <TouchableOpacity
          onPress={doShare}
          disabled={isShareDisabled}
          style={{ opacity: isShareDisabled ? 0.4 : 1 }}
        >
          <LinearGradient
            colors={GRAD_PRIMARY as unknown as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.shareBtn}
          >
            <Text style={styles.shareBtnText}>Share</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* TYPE TABS */}
      <View style={styles.typeTabs}>
        {TYPE_TABS.map(tab => {
          const active = tab.value === type;
          return (
            <TouchableOpacity
              key={tab.value}
              style={[
                styles.typeTab,
                active
                  ? { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE }
                  : { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.15)' },
              ]}
              onPress={() => setType(tab.value)}
            >
              <Feather
                name={tab.icon as any}
                size={ICON.sm}
                color={active ? PURPLE : 'rgba(255,255,255,0.6)'}
              />
              <Text
                style={[
                  styles.typeTabLabel,
                  { color: active ? PURPLE : 'rgba(255,255,255,0.6)' },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + SP.xl }}
      >
        {/* CANVAS */}
        <View style={styles.canvasWrapper}>
          <View style={[styles.canvas, { height: CANVAS_H }]}>
            {type === 'text' ? (
              <View style={[styles.canvasFill, { backgroundColor: bgColor }]}>
                <TextInput
                  style={[styles.textInput, { color: textColor }]}
                  value={textContent}
                  onChangeText={setTextContent}
                  placeholder="Tap to type..."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  multiline
                  textAlign="center"
                />
              </View>
            ) : (
              <TouchableOpacity
                style={styles.canvasFill}
                activeOpacity={0.8}
                onPress={() =>
                  Alert.alert(
                    'Coming soon',
                    'Photo library integration coming in next update.',
                  )
                }
              >
                <View style={styles.mediaPlaceholder}>
                  <Feather
                    name={type === 'photo' ? 'image' : 'video'}
                    size={48}
                    color="rgba(255,255,255,0.4)"
                  />
                  <Text style={styles.mediaPlaceholderText}>
                    Tap to choose from library
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* CONTROLS — text type only */}
        {type === 'text' && (
          <View style={styles.controlsPanel}>
            <Text style={styles.controlLabel}>Background</Text>
            <View style={styles.colorRow}>
              {BG_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: c },
                    bgColor === c && styles.colorCircleActive,
                  ]}
                  onPress={() => setBgColor(c)}
                />
              ))}
            </View>
            <Text style={[styles.controlLabel, { marginTop: SP.md }]}>Text color</Text>
            <View style={styles.colorRow}>
              {TEXT_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: c },
                    textColor === c && styles.colorCircleActive,
                    c === '#000000' && { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
                  ]}
                  onPress={() => setTextColor(c)}
                />
              ))}
            </View>
          </View>
        )}

        {/* PRIVACY */}
        <View style={styles.privacySection}>
          <View style={styles.privacyCard}>
            {/* Audience Row */}
            <TouchableOpacity
              style={styles.privacyRow}
              onPress={() =>
                Alert.alert('Audience', '', [
                  { text: 'Everyone', onPress: () => setPrivacyVis('public') },
                  { text: 'Friends only', onPress: () => setPrivacyVis('friends') },
                  { text: 'Cancel', style: 'cancel' },
                ])
              }
            >
              <Feather
                name={privacyVis === 'public' ? 'globe' : 'users'}
                size={ICON.md}
                color={PURPLE}
              />
              <Text style={styles.privacyLabel}>Who can see</Text>
              <Text style={styles.privacyValue}>
                {privacyVis === 'public' ? 'Everyone' : 'Friends only'}
              </Text>
              <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
            </TouchableOpacity>

            <View style={styles.privacyDivider} />

            {/* Replies Row */}
            <View style={styles.privacyRow}>
              <Feather name="message-circle" size={ICON.md} color={PURPLE} />
              <Text style={[styles.privacyLabel, { flex: 1 }]}>Replies</Text>
              <Switch
                value={allowReplies}
                onValueChange={setAllowReplies}
                trackColor={{ false: BORDER, true: PURPLE }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    paddingBottom: SP.sm,
  },
  closeBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: FS.xxl,
    fontFamily: FONT.bold,
    lineHeight: FS.xxl + 4,
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    textAlign: 'center',
  },
  shareBtn: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
  },
  shareBtnText: {
    color: '#fff',
    fontFamily: FONT.semibold,
    fontSize: FS.base,
  },
  typeTabs: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
  },
  typeTab: {
    flex: 1,
    height: 36,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    borderWidth: 1,
  },
  typeTabLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
  },
  canvasWrapper: {
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
  },
  canvas: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  canvasFill: {
    flex: 1,
    backgroundColor: '#111',
  },
  textInput: {
    flex: 1,
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    textAlign: 'center',
    padding: SP.xl,
  },
  mediaPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: RADIUS.lg,
  },
  mediaPlaceholderText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    marginTop: SP.md,
  },
  controlsPanel: {
    paddingHorizontal: SP.md,
    marginTop: SP.md,
  },
  controlLabel: {
    color: '#fff',
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    marginBottom: SP.sm,
  },
  colorRow: {
    flexDirection: 'row',
    gap: SP.sm,
  },
  colorCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorCircleActive: {
    borderWidth: 2,
    borderColor: PURPLE,
  },
  privacySection: {
    paddingHorizontal: SP.md,
    marginTop: SP.md,
  },
  privacyCard: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    gap: SP.sm,
  },
  privacyLabel: {
    color: FG,
    fontFamily: FONT.medium,
    fontSize: FS.base,
    flex: 1,
  },
  privacyValue: {
    color: MUTED,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    marginRight: SP.xs,
  },
  privacyDivider: {
    height: 1,
    backgroundColor: BORDER,
  },
});

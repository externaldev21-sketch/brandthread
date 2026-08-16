import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  StyleSheet, TextInput, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  BG, SURFACE, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, ON_DARK,
  GRAD_PRIMARY, FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { createPost } from '@/services/socialService';
import type { BuyerPostType, BuyerPostVisibility } from '@/services/socialTypes';

type PostType = BuyerPostType;
type Visibility = BuyerPostVisibility;

const TYPE_OPTIONS: { key: PostType; label: string; icon: string }[] = [
  { key: 'photo', label: 'Photo', icon: 'image' },
  { key: 'slideshow', label: 'Slideshow', icon: 'layers' },
  { key: 'video', label: 'Video', icon: 'video' },
];

const MEDIA_COLORS: Record<PostType, [string, string]> = {
  photo: [SURFACE, BG],
  slideshow: ['#0d1a0d', '#0a140a'],
  video: ['#1a0d00', '#140a00'],
};

export default function BuyerPostCreateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [postType, setPostType] = useState<PostType>('photo');
  const [caption, setCaption] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [loading, setLoading] = useState(false);

  const handleHashtagSubmit = useCallback(() => {
    const tags = hashtagInput
      .split(/\s+/)
      .filter(t => t.startsWith('#') && t.length > 1);
    setHashtags(tags);
  }, [hashtagInput]);

  const handlePublish = async () => {
    if (!caption.trim()) return;
    setLoading(true);
    try {
      await createPost({
        type: postType,
        caption: caption.trim(),
        hashtags,
        mediaColors: MEDIA_COLORS[postType],
        profileVisibility: visibility,
      });
      Alert.alert('Posted!', 'Your post is live.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Error', 'Could not publish post. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDraft = async () => {
    setLoading(true);
    try {
      await createPost({
        type: postType,
        caption: caption.trim(),
        hashtags,
        mediaColors: MEDIA_COLORS[postType],
        profileVisibility: visibility,
        isDraft: true,
      });
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save draft.');
    } finally {
      setLoading(false);
    }
  };

  const canPublish = caption.trim().length > 0 && !loading;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerSide}>
          <Text style={styles.closeBtn}>×</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Post</Text>
        <TouchableOpacity
          onPress={handlePublish}
          disabled={!canPublish}
          style={styles.headerSide}
        >
          <Text style={[styles.postBtn, !canPublish && styles.postBtnDisabled]}>
            Post
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + SP.xxl }]}
      >
        {/* Type Picker */}
        <View style={styles.typePicker}>
          {TYPE_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.typePill, postType === opt.key && styles.typePillActive]}
              onPress={() => setPostType(opt.key)}
            >
              <Feather
                name={opt.icon as any}
                size={ICON.sm}
                color={postType === opt.key ? PURPLE : MUTED}
              />
              <Text style={[styles.typePillText, postType === opt.key && styles.typePillTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Media Area */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            Alert.alert('Coming soon', 'Photo library integration coming in next update.')
          }
          style={styles.mediaAreaWrap}
        >
          <LinearGradient
            colors={MEDIA_COLORS[postType]}
            style={styles.mediaArea}
          >
            <Feather
              name={TYPE_OPTIONS.find(t => t.key === postType)?.icon as any ?? 'image'}
              size={48}
              color={MUTED}
            />
            <Text style={styles.mediaAreaHint}>Tap to choose from library</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Caption Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Caption</Text>
          <TextInput
            style={styles.captionInput}
            multiline
            placeholder="Write a caption..."
            placeholderTextColor={SUBTLE}
            value={caption}
            onChangeText={setCaption}
            textAlignVertical="top"
          />
        </View>

        {/* Hashtags Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Hashtags</Text>
          <TextInput
            style={styles.hashtagInput}
            placeholder="#streetwear #fashion"
            placeholderTextColor={SUBTLE}
            value={hashtagInput}
            onChangeText={setHashtagInput}
            onSubmitEditing={handleHashtagSubmit}
            onBlur={handleHashtagSubmit}
            returnKeyType="done"
            autoCapitalize="none"
          />
          {hashtags.length > 0 && (
            <View style={styles.hashtagPreview}>
              {hashtags.map(tag => (
                <View key={tag} style={styles.hashtagBadge}>
                  <Text style={styles.hashtagBadgeText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Visibility Section */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Visibility</Text>
          <View style={styles.visibilityCard}>
            <TouchableOpacity
              style={styles.visibilityRow}
              onPress={() => setVisibility('public')}
            >
              <Feather name="globe" size={ICON.md} color={FG} />
              <View style={styles.visibilityInfo}>
                <Text style={styles.visibilityTitle}>Public</Text>
                <Text style={styles.visibilityDesc}>Anyone can see this post</Text>
              </View>
              <RadioCircle selected={visibility === 'public'} />
            </TouchableOpacity>
            <View style={styles.visibilityDivider} />
            <TouchableOpacity
              style={styles.visibilityRow}
              onPress={() => setVisibility('friends_only')}
            >
              <Feather name="users" size={ICON.md} color={FG} />
              <View style={styles.visibilityInfo}>
                <Text style={styles.visibilityTitle}>Friends only</Text>
                <Text style={styles.visibilityDesc}>Only your friends can see this</Text>
              </View>
              <RadioCircle selected={visibility === 'friends_only'} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Bottom Buttons */}
        <View style={styles.bottomButtons}>
          <TouchableOpacity
            style={styles.draftBtn}
            onPress={handleDraft}
            disabled={loading}
          >
            <Text style={styles.draftBtnText}>Save Draft</Text>
          </TouchableOpacity>

          <View style={{ height: SP.sm }} />

          <TouchableOpacity
            onPress={handlePublish}
            disabled={!canPublish}
            style={[styles.publishBtnWrap, !canPublish && styles.publishBtnDisabled]}
            activeOpacity={canPublish ? 0.85 : 1}
          >
            <LinearGradient
              colors={GRAD_PRIMARY as unknown as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.publishBtn}
            >
              {loading ? (
                <ActivityIndicator color={ON_DARK} />
              ) : (
                <Text style={styles.publishBtnText}>Publish Post</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function RadioCircle({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
      {selected && <View style={styles.radioDot} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerSide: {
    minWidth: 50,
  },
  closeBtn: {
    fontFamily: FONT.regular,
    fontSize: FS.xl,
    color: MUTED,
    lineHeight: 30,
  },
  headerTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
    textAlign: 'center',
  },
  postBtn: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: PURPLE,
    textAlign: 'right',
  },
  postBtnDisabled: {
    color: MUTED,
  },
  scrollContent: {
    paddingTop: SP.md,
  },
  typePicker: {
    flexDirection: 'row',
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  typePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingVertical: SP.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.pill,
  },
  typePillActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  typePillText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  typePillTextActive: {
    color: PURPLE,
  },
  mediaAreaWrap: {
    marginHorizontal: SP.md,
    marginTop: SP.md,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    height: 200,
  },
  mediaArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  mediaAreaHint: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: SUBTLE,
    marginTop: SP.sm,
  },
  section: {
    paddingHorizontal: SP.md,
    marginTop: SP.lg,
  },
  sectionLabel: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: MUTED,
    marginBottom: SP.xs,
  },
  captionInput: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    padding: SP.md,
    minHeight: 80,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    textAlignVertical: 'top',
    color: FG,
  },
  hashtagInput: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    padding: SP.md,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: PURPLE,
  },
  hashtagPreview: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
    marginTop: SP.sm,
  },
  hashtagBadge: {
    backgroundColor: PURPLE_DIM,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
  },
  hashtagBadgeText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: PURPLE,
  },
  visibilityCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SP.md,
    gap: SP.md,
  },
  visibilityDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: SP.md,
  },
  visibilityInfo: {
    flex: 1,
  },
  visibilityTitle: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: FG,
  },
  visibilityDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    marginTop: 2,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PURPLE,
  },
  bottomButtons: {
    paddingHorizontal: SP.md,
    marginTop: SP.xl,
  },
  draftBtn: {
    height: 48,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: MUTED,
  },
  publishBtnWrap: {
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  publishBtnDisabled: {
    opacity: 0.4,
  },
  publishBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: ON_DARK,
  },
});

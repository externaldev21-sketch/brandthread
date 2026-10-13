/**
 * Notes composer — a 1:1 copy of Instagram's "Leave a note" flow
 * (Mobbin: Instagram › Adding a note,
 * https://mobbin.com/flows/dc15d6ce-52ae-4c18-a966-009c824e55d4),
 * reskinned in Brandthread's black/white/silver on the shared `<Sheet>`:
 *
 *  1. Close (X) top-left, no title.
 *  2. Your avatar, centred, with the note bubble above it. You type straight
 *     into the bubble, so it IS the live preview of what people will see.
 *  3. Bottom bar, sitting on the keyboard: the audience on the left
 *     ("Followers you follow back ⌄"), the Share button on the right, enabled
 *     once there's text. A character ring sits beside Share.
 *  4. Tapping the audience opens the "Share with" picker (radio rows).
 *
 * The keyboard opens immediately and the whole sheet rides on top of it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { Sheet, SheetCloseButton } from '@/components/ui/BottomSheet';
import { OptionSheet } from '@/components/ui/OptionSheet';
import { radius } from '@/constants/radii';
import { FONT } from '@/lib/theme';
import { hapticLight, hapticMedium, hapticSuccess, hapticError } from '@/lib/haptics';
import { NOTE_MAX_CHARS, type NoteAudience } from '@/services/socialTypes';

export const NOTE_AUDIENCE_LABEL: Record<Exclude<NoteAudience, 'followers'>, string> = {
  friends: 'Followers you follow back',
  close_friends: 'Close friends',
};

const AVATAR = 96;
const LINE = 22;
const RING = 22;
const RING_STROKE = 2.5;

export interface NoteComposerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Pre-filled when editing an existing note. */
  initialText?: string;
  initialAudience?: NoteAudience;
  avatarUri?: string | null;
  initials?: string;
  /** Posts the note. Throw to keep the sheet open with an error. */
  onShare: (text: string, audience: Exclude<NoteAudience, 'followers'>) => Promise<void>;
}

export function NoteComposerSheet({
  visible, onClose, initialText = '', initialAudience, avatarUri, initials, onShare,
}: NoteComposerSheetProps) {
  const { theme } = useAppTheme();
  const [text, setText] = useState(initialText);
  const [audience, setAudience] = useState<Exclude<NoteAudience, 'followers'>>(
    initialAudience === 'close_friends' ? 'close_friends' : 'friends',
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Explicit content height: a web <textarea> defaults to 2 rows, so the
  // bubble would never hug a one-line note otherwise.
  const [inputH, setInputH] = useState(LINE);
  const inputRef = useRef<TextInput>(null);

  // Fresh state every time the sheet opens (edit pre-fills the current note).
  useEffect(() => {
    if (!visible) return;
    setText(initialText);
    setAudience(initialAudience === 'close_friends' ? 'close_friends' : 'friends');
    setFailed(false);
    // autoFocus alone is unreliable inside a Modal that's still animating in.
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [visible, initialText, initialAudience]);

  const trimmed = text.trim();
  const canShare = trimmed.length > 0 && !saving;
  const remaining = NOTE_MAX_CHARS - text.length;

  async function share() {
    if (!canShare) return;
    hapticMedium();
    setSaving(true);
    setFailed(false);
    try {
      await onShare(trimmed, audience);
      hapticSuccess();
    } catch {
      hapticError();
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const bubbleBg = `${theme.text}1F`;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      headerLeft={<SheetCloseButton onPress={onClose} />}
      headerRight="none"
      accessibilityLabel={initialText ? 'Edit your note' : 'New note'}
      testID="note-composer-sheet"
      footer={(
        <View style={styles.bar}>
          <PressableScale
            onPress={() => { hapticLight(); setPickerOpen(true); }}
            style={styles.audience}
            accessibilityRole="button"
            accessibilityLabel={`Share with ${NOTE_AUDIENCE_LABEL[audience]}`}
            accessibilityHint="Changes who can see your note"
            testID="note-audience"
          >
            <Feather name={audience === 'close_friends' ? 'star' : 'users'} size={16} color={theme.text} />
            <Text style={[styles.audienceLabel, { color: theme.text }]} numberOfLines={1}>
              {NOTE_AUDIENCE_LABEL[audience]}
            </Text>
            <Feather name="chevron-down" size={16} color={theme.text} />
          </PressableScale>
          <View style={styles.barRight}>
            {remaining <= 10 ? (
              <Text
                style={[styles.remaining, { color: remaining <= 0 ? theme.error : theme.muted }]}
                accessibilityLabel={`${remaining} characters left`}
              >
                {remaining}
              </Text>
            ) : null}
            <CharacterRing used={text.length} max={NOTE_MAX_CHARS} color={remaining <= 0 ? theme.error : theme.text} track={`${theme.text}26`} />
            <PressableScale
              onPress={share}
              disabled={!canShare}
              style={[styles.share, { backgroundColor: theme.accent }, !canShare && !saving && styles.shareDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Share note"
              accessibilityState={{ disabled: !canShare, busy: saving }}
              testID="note-share"
            >
              {saving
                ? <ActivityIndicator color={theme.onAccent} size="small" />
                : <Text style={[styles.shareLabel, { color: theme.onAccent }]}>Share</Text>}
            </PressableScale>
          </View>
        </View>
      )}
    >
      <View style={styles.stage}>
        <View style={styles.bubbleWrap}>
          <View style={[styles.bubble, { backgroundColor: bubbleBg }]}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={t => { setText(t.slice(0, NOTE_MAX_CHARS)); if (failed) setFailed(false); }}
              placeholder="Share a thought…"
              placeholderTextColor={theme.muted}
              maxLength={NOTE_MAX_CHARS}
              multiline
              autoFocus
              textAlign="center"
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={share}
              onContentSizeChange={e => setInputH(Math.min(LINE * 3, Math.max(LINE, Math.ceil(e.nativeEvent.contentSize.height))))}
              style={[styles.input, { color: theme.text, height: inputH }, Platform.OS === 'web' && styles.inputWeb]}
              accessibilityLabel="Note text"
              testID="inbox-note-compose-input"
            />
          </View>
          {/* Thought-bubble tail: two shrinking dots down toward the avatar. */}
          <View style={[styles.tailDot, styles.tailDotBig, { backgroundColor: bubbleBg }]} />
          <View style={[styles.tailDot, styles.tailDotSmall, { backgroundColor: bubbleBg }]} />
        </View>
        <View style={[styles.avatar, { backgroundColor: `${theme.text}1F` }]}>
          {/* Initials underneath, so a slow or failed photo never leaves a blank circle. */}
          <Text style={[styles.initials, { color: theme.text }]}>{initials ?? ''}</Text>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" transition={150} />
          ) : null}
        </View>
        {failed ? (
          <Text style={[styles.error, { color: theme.error }]} accessibilityLiveRegion="polite">
            Couldn’t share your note. Try again.
          </Text>
        ) : null}
      </View>

      <OptionSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Share with"
        options={[
          { id: 'friends', label: NOTE_AUDIENCE_LABEL.friends, icon: 'users' },
          { id: 'close_friends', label: NOTE_AUDIENCE_LABEL.close_friends, icon: 'star' },
        ]}
        selectedId={audience}
        onSelect={id => { setAudience(id as Exclude<NoteAudience, 'followers'>); setPickerOpen(false); }}
        testID="note-audience-sheet"
      />
    </Sheet>
  );
}

/** Twitter/X-style progress ring: fills clockwise as the note nears 60. */
function CharacterRing({ used, max, color, track }: { used: number; max: number; color: string; track: string }) {
  const r = (RING - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const progress = Math.min(1, used / max);
  return (
    <Svg width={RING} height={RING} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={track} strokeWidth={RING_STROKE} fill="none" />
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        stroke={color}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c} ${c}`}
        strokeDashoffset={c * (1 - progress)}
        transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', paddingTop: 8, paddingBottom: 20 },
  bubbleWrap: { alignItems: 'center', marginBottom: 14 },
  bubble: {
    minWidth: 160,
    maxWidth: 280,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  input: {
    fontFamily: FONT.medium,
    fontSize: 17,
    lineHeight: LINE,
    padding: 0,
    textAlign: 'center',
  },
  inputWeb: { outlineStyle: 'none' } as object,
  tailDot: { position: 'absolute', borderRadius: 99 },
  tailDotBig: { width: 12, height: 12, bottom: -10, left: '42%' },
  tailDotSmall: { width: 6, height: 6, bottom: -18, left: '38%' },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  initials: { fontFamily: FONT.semibold, fontSize: 28 },
  error: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  audience: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minHeight: 44 },
  audienceLabel: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  barRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 12 },
  remaining: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 18 },
  share: {
    height: 36,
    minWidth: 76,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareDisabled: { opacity: 0.4 },
  shareLabel: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20 },
});


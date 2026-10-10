/**
 * Viewer-side pieces for story @mentions and reshares (app/buyer-story-viewer.tsx):
 *  - ViewerMentionStickers: each mention drawn exactly like the composer (style,
 *    opacity, scale, rotation, position) with a >=44pt tap target centred on it,
 *    so even a speck / fully faded / edge-tucked sticker can be tapped.
 *  - ViewerReshareCard: the original story as a card; credit comes from
 *    story.original (never from media) and opens the original when available.
 *  - MentionPopover: the small "View profile" card a tap opens.
 *  - TaggedPeopleSheet: everyone tagged on the slide (works with invisible stickers).
 */
import React, { useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CARD, BORDER, FG, FONT, FS, MUTED, ON_DARK, RADIUS, SP } from '@/lib/theme';
import { ModalSafeArea } from '@/components/ModalSafeArea';
import { MentionStickerView, ReshareCard, RESHARE_CARD_HEIGHT, RESHARE_CARD_WIDTH } from '@/components/StoryMentionSticker';
import {
  clampMentionOpacity, clampOverlayScale, mentionHitRect, withAt, type TaggedPerson,
} from '@/lib/storyMentionSticker';
import type { StoryOriginal, StoryOverlay } from '@/services/socialTypes';
import { radius } from '@/constants/radii';

const { width: W, height: H } = Dimensions.get('window');

export type MentionTap = { person: TaggedPerson; anchor: { x: number; y: number } };

function ViewerMention({ overlay, onTap }: { overlay: StoryOverlay; onTap: (t: MentionTap) => void }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scale = clampOverlayScale('mention', overlay.scale ?? 1);
  const hit = mentionHitRect({ x: overlay.x, y: overlay.y, scale }, size);
  const canTap = !!overlay.mentionUserId && size.width > 0;
  return (
    <>
      <View
        pointerEvents="none"
        onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        style={{
          position: 'absolute', left: overlay.x, top: overlay.y,
          opacity: clampMentionOpacity(overlay.opacity),
          transform: [{ scale }, { rotate: `${overlay.rotation ?? 0}deg` }],
        }}
      >
        <MentionStickerView handle={overlay.mentionHandle} variant={overlay.mentionStyle} />
      </View>
      {canTap ? (
        <Pressable
          onPress={() => onTap({
            person: { userId: overlay.mentionUserId as string, handle: overlay.mentionHandle ?? '', name: overlay.mentionName },
            anchor: { x: hit.left + hit.width / 2, y: hit.top + hit.height / 2 },
          })}
          style={{ position: 'absolute', left: hit.left, top: hit.top, width: hit.width, height: hit.height }}
          accessibilityRole="button"
          accessibilityLabel={`View ${withAt(overlay.mentionHandle)}`}
          testID={`story-mention-hit-${overlay.id}`}
        />
      ) : null}
    </>
  );
}

export function ViewerMentionStickers({ overlays, onTap }: { overlays: StoryOverlay[]; onTap: (t: MentionTap) => void }) {
  return (
    <>
      {overlays.filter((o) => o.type === 'mention').map((o) => <ViewerMention key={o.id} overlay={o} onTap={onTap} />)}
    </>
  );
}

export function ViewerReshareCard({
  overlay, original, onOpenOriginal,
}: {
  overlay: StoryOverlay;
  original?: StoryOriginal | null;
  onOpenOriginal: (storyId: string) => void;
}) {
  const unavailable = !!original && !original.available;
  const canOpen = !!original && original.available;
  const transform = [{ scale: overlay.scale ?? 1 }, { rotate: `${overlay.rotation ?? 0}deg` }];
  const box = { position: 'absolute' as const, left: overlay.x, top: overlay.y, width: RESHARE_CARD_WIDTH, height: RESHARE_CARD_HEIGHT, transform };
  return (
    <>
      <View pointerEvents="none" style={box}>
        <ReshareCard imageUri={overlay.cardImageUri} radius={overlay.cardRadius} handle={original?.authorHandle} unavailable={unavailable} />
      </View>
      {canOpen ? (
        // Only the credit row is interactive, so the rest of the card keeps the normal tap-to-advance zones.
        <View pointerEvents="box-none" style={box}>
          <Pressable
            onPress={() => onOpenOriginal(original.storyId)}
            style={styles.creditHit}
            accessibilityRole="button"
            accessibilityLabel={`Open ${withAt(original.authorHandle)}'s story`}
            testID="story-reshare-credit"
          />
        </View>
      ) : null}
    </>
  );
}

export function MentionPopover({
  target, onClose, onViewProfile,
}: {
  target: MentionTap | null;
  onClose: () => void;
  onViewProfile: (p: TaggedPerson) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!target) return null;
  const { person, anchor } = target;
  const cardW = 232;
  const cardH = 136;
  const left = Math.max(SP.md, Math.min(W - cardW - SP.md, anchor.x - cardW / 2));
  const below = anchor.y + 32 + cardH < H - insets.bottom - SP.md;
  const top = Math.max(insets.top + SP.md, below ? anchor.y + 32 : anchor.y - 32 - cardH);
  return (
    <View style={styles.popoverLayer} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.popover, { left, top, width: cardW }]} testID="story-mention-popover">
        <View style={styles.popoverRow}>
          <Avatar person={person} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.popoverHandle} numberOfLines={1}>{withAt(person.handle)}</Text>
            {person.name ? <Text style={styles.popoverName} numberOfLines={1}>{person.name}</Text> : null}
          </View>
        </View>
        <Pressable
          style={styles.popoverBtn}
          onPress={() => onViewProfile(person)}
          accessibilityRole="button"
          accessibilityLabel="View profile"
          testID="story-mention-view-profile"
        >
          <Text style={styles.popoverBtnText}>View profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Avatar({ person, size }: { person: TaggedPerson; size: number }) {
  const seed = (person.name || person.handle || '?').replace(/^@+/, '');
  const initials = seed.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

export function TaggedPeopleSheet({
  visible, people, onClose, onOpen,
}: {
  visible: boolean;
  people: TaggedPerson[];
  onClose: () => void;
  onOpen: (p: TaggedPerson) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ModalSafeArea>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]} testID="story-tagged-sheet">
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Tagged people</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="x" size={22} color={FG} />
            </Pressable>
          </View>
          <FlatList
            data={people}
            keyExtractor={(p) => p.userId}
            renderItem={({ item }) => (
              <Pressable style={styles.sheetRow} onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={`View ${withAt(item.handle)}`}>
                <Avatar person={item} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.popoverHandle} numberOfLines={1}>{withAt(item.handle)}</Text>
                  {item.name ? <Text style={styles.popoverName} numberOfLines={1}>{item.name}</Text> : null}
                </View>
                <Icon name="chevron-right" size={18} color={MUTED} />
              </Pressable>
            )}
          />
        </View>
      </ModalSafeArea>
    </Modal>
  );
}

const styles = StyleSheet.create({
  creditHit: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 },
  popoverLayer: { ...({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const), zIndex: 40 },
  popover: {
    position: 'absolute', backgroundColor: CARD, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: BORDER,
    padding: SP.md, gap: SP.md,
  },
  popoverRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  popoverHandle: { color: FG, fontFamily: FONT.semibold, fontSize: FS.base },
  popoverName: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },
  popoverBtn: { minHeight: 44, borderRadius: radius.md, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  popoverBtnText: { color: '#000000', fontFamily: FONT.semibold, fontSize: FS.sm },
  avatar: { backgroundColor: '#2A2A2E', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.sm },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '60%', backgroundColor: CARD,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderTopWidth: 1, borderColor: BORDER, paddingTop: SP.md,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  sheetTitle: { flex: 1, color: FG, fontFamily: FONT.semibold, fontSize: FS.md },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, minHeight: 56 },
});

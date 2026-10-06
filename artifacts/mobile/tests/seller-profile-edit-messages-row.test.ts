import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const controls = readFileSync(resolve(process.cwd(), 'components/profile/ProfileControls.tsx'), 'utf8');

/**
 * Seller profile action row (Dev-approved): Edit compact on the left
 * (black + 1pt silver border, white text) + one long white Messages button
 * filling the rest of the row (black text, unread badge), replacing the old
 * three-button Edit/Share/Contact row (see seller-profile-analytics-layout
 * test for the screen-level wiring). 38-40pt tall, 10pt radius, Inter 600,
 * 44pt hit area via hitSlop rather than growing the visible pill.
 *
 * Messages is wrapped in a plain `messagesBtnWrap` View that carries
 * `flex: 1`, not PressableScale itself: PressableScale forwards a
 * plain-object `style` only to its inner Animated.View, never to the outer
 * Pressable that actually participates in the row's flex layout, so `flex: 1`
 * set directly on PressableScale's own style silently did nothing — the
 * button rendered barely wider than Edit instead of filling the row (a real
 * bug caught in live verification, fixed here). `editMessagesRow` itself
 * also needs an explicit `width: '100%'` for the same reason one level up:
 * it's the sole child of the caller's row-direction `actionRow`, which gives
 * it nothing to stretch into on its own.
 */
describe('ProfileEditMessagesRow', () => {
  it('Edit is black with a 1pt silver border and white text', () => {
    expect(controls).toContain("style={[styles.editBtn, { backgroundColor: theme.card, borderColor: theme.border }]}");
    expect(controls).toContain('<Text style={[styles.editMessagesLabel, { color: theme.text }]} numberOfLines={1}>Edit</Text>');
  });

  it('Messages fills the rest of the row via a flex:1 wrapper View, not PressableScale itself', () => {
    expect(controls).toContain('messagesBtnWrap: { flex: 1 },');
    expect(controls).toContain('<View style={styles.messagesBtnWrap}>');
    expect(controls).toContain("style={[styles.messagesBtn, { backgroundColor: theme.accent }]}");
    expect(controls).toContain('<Text style={[styles.editMessagesLabel, { color: theme.onAccent }]} numberOfLines={1}>Messages</Text>');
  });

  it("the row itself is full-width so it isn't shrunk to its children's content size by its row-direction parent", () => {
    expect(controls).toContain("editMessagesRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, width: '100%' },");
  });

  it('shows an unread-count badge on Messages only when there is unread mail', () => {
    expect(controls).toContain('{unreadCount > 0 && (');
    expect(controls).toContain("{unreadCount > 99 ? '99+' : unreadCount}");
  });

  it('both buttons are 39pt tall with a 10pt (RADIUS.sm) radius and a padded 44pt-ish hit area', () => {
    expect(controls).toContain("editBtn: {\n    width: '100%', height: 39, borderRadius: RADIUS.sm, borderWidth: 1,");
    expect(controls).toContain("messagesBtn: {\n    width: '100%', height: 39, borderRadius: RADIUS.sm,");
    expect(controls).toContain("const hitSlop = { top: 3, bottom: 3, left: 3, right: 3 };");
  });

  it('labels are semibold (Inter 600), not the bold weight the old three-button row used', () => {
    expect(controls).toContain('editMessagesLabel: { fontFamily: FONT.semibold, fontSize: FS.base },');
  });
});

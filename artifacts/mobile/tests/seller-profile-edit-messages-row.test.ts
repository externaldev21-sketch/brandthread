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
 */
describe('ProfileEditMessagesRow', () => {
  it('Edit is black with a 1pt silver border and white text', () => {
    expect(controls).toContain("style={[styles.editBtn, { backgroundColor: theme.card, borderColor: theme.border }]}");
    expect(controls).toContain('<Text style={[styles.editMessagesLabel, { color: theme.text }]} numberOfLines={1}>Edit</Text>');
  });

  it('Messages is a long white button (flex: 1) with black text and fills the rest of the row', () => {
    expect(controls).toContain('messagesBtn: {\n    flex: 1');
    expect(controls).toContain("style={[styles.messagesBtn, { backgroundColor: theme.accent }]}");
    expect(controls).toContain('<Text style={[styles.editMessagesLabel, { color: theme.onAccent }]} numberOfLines={1}>Messages</Text>');
  });

  it('shows an unread-count badge on Messages only when there is unread mail', () => {
    expect(controls).toContain('{unreadCount > 0 && (');
    expect(controls).toContain("{unreadCount > 99 ? '99+' : unreadCount}");
  });

  it('both buttons are 39pt tall with a 10pt (RADIUS.sm) radius and a padded 44pt-ish hit area', () => {
    expect(controls).toContain('editBtn: {\n    height: 39, borderRadius: RADIUS.sm, borderWidth: 1,');
    expect(controls).toContain('messagesBtn: {\n    flex: 1, height: 39, borderRadius: RADIUS.sm,');
    expect(controls).toContain("const hitSlop = { top: 3, bottom: 3, left: 3, right: 3 };");
  });

  it('labels are semibold (Inter 600), not the bold weight the old three-button row used', () => {
    expect(controls).toContain('editMessagesLabel: { fontFamily: FONT.semibold, fontSize: FS.base },');
  });
});

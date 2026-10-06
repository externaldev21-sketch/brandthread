/**
 * Regression guard for the Messages QA pass: `Alert.alert(title, message,
 * buttons)` with a real button array is a silent no-op on web
 * (react-native-web's Alert.alert is `static alert() {}` — see
 * components/ui/ActionSheet.tsx's own header comment), so every "Options"/
 * "..." menu built that way left the button completely dead in the web
 * preview: no dialog, no error, nothing. The fix (already used elsewhere in
 * this codebase, e.g. app/activity-center.tsx) is `showActionSheet`, which
 * takes the identical `{ text, onPress, style }[]` shape and renders a real
 * themed bottom sheet on every platform, including web.
 *
 * This asserts each Messages-surface call site that opens a genuine options
 * menu (more than a plain two-arg confirmation `Alert.alert`) uses
 * `showActionSheet`, not `Alert.alert`, so this class of bug can't silently
 * come back on any of these screens.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Messages "Options" menus use showActionSheet, not the dead-on-web Alert.alert', () => {
  it('conversation thread header "..." menu (openOptions) — buyer and seller share it', () => {
    const src = read('components/chat/ConversationThread.tsx');
    const fn = src.slice(src.indexOf('function openOptions()'), src.indexOf('function openOptions()') + 800);
    expect(fn).toContain("showActionSheet('Options'");
    expect(fn).not.toMatch(/Alert\.alert\(\s*'Options'/);
  });

  it('(buyer)/inbox.tsx row long-press menu (longPressConversation)', () => {
    const src = read('components/inbox/MessagesInbox.tsx');
    const fn = src.slice(src.indexOf('function longPressConversation'), src.indexOf('function longPressConversation') + 600);
    expect(fn).toContain("showActionSheet('Options'");
    expect(fn).not.toMatch(/Alert\.alert\(\s*'Options'/);
  });

  it('conversation-details.tsx "Options" action button (openOptions)', () => {
    const src = read('app/conversation-details.tsx');
    const fn = src.slice(src.indexOf('function openOptions()'), src.indexOf('function openOptions()') + 600);
    expect(fn).toContain('showActionSheet(displayName');
    expect(fn).not.toMatch(/Alert\.alert\(\s*displayName/);
  });

  it('seller conversation header "..." menu (DmSafety.openConversationOptions)', () => {
    const src = read('components/safety/DmSafety.tsx');
    expect(src).toContain('showActionSheet(counterpart.name');
    expect(src).not.toMatch(/Alert\.alert\(\s*(counterpart\.name|'Message')/);
    expect(src).not.toMatch(/import \{ Alert,/);
  });

  it('VoiceMessageBubble\'s "View transcription" is wired to a real, screen-owned toast on both sides', () => {
    const voiceBubble = read('components/chat/VoiceMessageBubble.tsx');
    // Alert.alert() stays as the native fallback for a caller that doesn't
    // pass onViewTranscription, but every real call site below must pass
    // one rather than relying on that dead-on-web default.
    expect(voiceBubble).toContain('onViewTranscription?: () => void');
    expect(voiceBubble).toContain('onPress={onViewTranscription ?? (() => Alert.alert(');

    // Both sides render the one shared thread screen.
    const thread = read('components/chat/ConversationThread.tsx');
    expect(thread).toContain('onViewTranscription={() => {');
    expect(thread).toContain('setTranscriptionToast(true)');
    expect(read('app/buyer-conversation.tsx')).toContain('<ConversationThread variant="buyer" />');
    expect(read('app/seller-conversation.tsx')).toContain('<ConversationThread variant="seller" />');
  });

  it('inbox "Filter messages" pill gives real feedback instead of a dead Alert.alert', () => {
    const src = read('components/inbox/MessagesInbox.tsx');
    const fn = src.slice(src.indexOf('function openFilterMenu()'), src.indexOf('function openFilterMenu()') + 600);
    expect(fn).toContain('showSnackbar(');
    expect(fn).not.toMatch(/Alert\.alert\(\s*'/);
  });
});

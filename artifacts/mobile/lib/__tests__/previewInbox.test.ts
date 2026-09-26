import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import {
  BRANDTHREAD_AGENT_SEED,
  PREVIEW_CONVERSATION_SEEDS,
  PREVIEW_FOLLOWER_SEEDS,
} from '../previewInboxData';

// ── Seed shape vs. real Conversation/Message/Notification types ────────────
//
// previewInboxData.ts is pure (no react-native/expo-* imports), so it can be
// imported directly here. lib/previewInbox.ts (the module screens actually
// use) wraps this with bundled poster/logo image URIs the same way
// previewCatalog.ts does, which vitest cannot import directly (native/asset
// require() calls) — so its gating and dead-code-in-production guarantees
// are verified via source inspection below, matching devPreview.test.ts's
// established pattern for this exact limitation.

const REQUIRED_CONVERSATION_FIELDS = [
  'participants', 'lastMessage', 'lastMessageTs', 'unreadCount',
  'isFriendshipActive', 'isArchived', 'isRequest', 'updatedAt',
] as const;

const REQUIRED_PARTICIPANT_FIELDS = ['userId', 'name', 'handle', 'initials', 'color', 'accountType'] as const;

const REQUIRED_MESSAGE_FIELDS = ['id', 'text', 'ts', 'reactions', 'status', 'deletedForMe'] as const;

const VALID_ATTACHMENT_TYPES = new Set([
  'image', 'video', 'voice', 'product', 'post', 'order', 'profile', 'thread_cash',
]);

describe('previewInboxData — seed matches the real Conversation/Message shapes', () => {
  it('has 10 ordinary seeded threads plus the pinned Brandthread Agent thread', () => {
    expect(PREVIEW_CONVERSATION_SEEDS).toHaveLength(10);
    expect(BRANDTHREAD_AGENT_SEED.isPinned).toBe(true);
    expect(BRANDTHREAD_AGENT_SEED.isOfficial).toBe(true);
  });

  it('every seed id is unique and prefixed for isPreviewConversationId()', () => {
    const all = [BRANDTHREAD_AGENT_SEED, ...PREVIEW_CONVERSATION_SEEDS];
    const ids = all.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('preview-conversation-')).toBe(true);
  });

  it('every seed carries every field a real Conversation-derived row needs', () => {
    const all = [BRANDTHREAD_AGENT_SEED, ...PREVIEW_CONVERSATION_SEEDS];
    for (const seed of all) {
      expect(typeof seed.participantUserId).toBe('string');
      expect(typeof seed.participantName).toBe('string');
      expect(typeof seed.participantHandle).toBe('string');
      expect(typeof seed.participantInitials).toBe('string');
      expect(typeof seed.participantColor).toBe('string');
      expect(typeof seed.lastMessage).toBe('string');
      expect(typeof seed.lastMessageFromMe).toBe('boolean');
      expect(typeof seed.minutesAgo).toBe('number');
      expect(typeof seed.unreadCount).toBe('number');
      expect(typeof seed.isRequest).toBe('boolean');
      if (seed.lastMessageType) expect(VALID_ATTACHMENT_TYPES.has(seed.lastMessageType)).toBe(true);
    }
  });

  it('has at least one product/order attachment message and one Thread Cash message', () => {
    const messages = PREVIEW_CONVERSATION_SEEDS.flatMap(s => s.messages ?? []);
    expect(messages.some(m => m.attachment?.type === 'product')).toBe(true);
    expect(messages.some(m => m.attachment?.type === 'order')).toBe(true);
    expect(messages.some(m => m.attachment?.type === 'thread_cash')).toBe(true);
  });

  it('has 2-3 message-request threads', () => {
    const requestCount = PREVIEW_CONVERSATION_SEEDS.filter(s => s.isRequest).length;
    expect(requestCount).toBeGreaterThanOrEqual(2);
    expect(requestCount).toBeLessThanOrEqual(3);
  });

  it('has at least one unread thread and one exactly-now thread', () => {
    expect(PREVIEW_CONVERSATION_SEEDS.some(s => s.unreadCount > 0)).toBe(true);
    expect(PREVIEW_CONVERSATION_SEEDS.some(s => s.minutesAgo === 0)).toBe(true);
  });

  it('has exactly one seed flagged for the simulated typing indicator', () => {
    const typingSeeds = PREVIEW_CONVERSATION_SEEDS.filter(s => s.simulateTyping);
    expect(typingSeeds).toHaveLength(1);
  });

  it('every message in every thread has the fields a real Message needs', () => {
    const all = [BRANDTHREAD_AGENT_SEED, ...PREVIEW_CONVERSATION_SEEDS];
    for (const seed of all) {
      for (const msg of seed.messages ?? []) {
        expect(typeof msg.id).toBe('string');
        expect(typeof msg.text).toBe('string');
        expect(typeof msg.minutesAgo).toBe('number');
        expect(['me', 'them']).toContain(msg.fromOfficialOrParticipant);
        if (msg.attachment) expect(VALID_ATTACHMENT_TYPES.has(msg.attachment.type)).toBe(true);
      }
    }
  });

  it('the Brandthread Agent thread has a welcome message and a Thread Cash explainer card', () => {
    const messages = BRANDTHREAD_AGENT_SEED.messages ?? [];
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].text.toLowerCase()).toContain('welcome');
    const explainer = messages.find(m => m.attachment?.title?.toLowerCase().includes('thread cash'));
    expect(explainer).toBeTruthy();
    // Reuses an existing generic attachment type ('post') rather than
    // inventing a new one — see the comment in lib/previewInbox.ts.
    expect(explainer?.attachment?.type).toBe('post');
  });

  it('follower seeds carry the fields a real Notification needs', () => {
    expect(PREVIEW_FOLLOWER_SEEDS.length).toBeGreaterThan(0);
    for (const f of PREVIEW_FOLLOWER_SEEDS) {
      expect(typeof f.id).toBe('string');
      expect(typeof f.actorUserId).toBe('string');
      expect(typeof f.actorName).toBe('string');
      expect(typeof f.isRead).toBe('boolean');
      expect(typeof f.minutesAgo).toBe('number');
    }
  });
});

// ── Gating + dead-code-in-production guarantees (source inspection) ────────
//
// lib/previewInbox.ts imports `expo-asset` and requires bundled PNGs at
// module scope, which Vitest cannot transform (same limitation documented in
// lib/previewCatalog.ts and lib/__tests__/devPreview.test.ts) — so its
// contract is verified by reading the source, not by importing it.

describe('previewInbox module contract (source check)', () => {
  const filePath = resolve(__dirname, '../previewInbox.ts');
  const src = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';

  it('exists at the expected path', () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it('reuses isPreviewCatalogEnabled() as its gate rather than inventing a new one', () => {
    expect(src).toContain("import { isPreviewCatalogEnabled } from './previewCatalog'");
    expect(src).toContain('return isPreviewCatalogEnabled();');
  });

  it('exports the functions call sites need', () => {
    expect(src).toContain('export function isPreviewInboxEnabled');
    expect(src).toContain('export function getPreviewConversations');
    expect(src).toContain('export function getPreviewConversation(');
    expect(src).toContain('export function getPreviewNotifications');
    expect(src).toContain('export function getPreviewMessages');
    expect(src).toContain('export function isPreviewConversationId');
    expect(src).toContain('export function subscribePreviewTyping');
  });

  it('never assumes __DEV__/preview is on without checking (no unconditional real-account use)', () => {
    // subscribePreviewTyping and every getter must be guarded — spot check
    // the one function most likely to run on a timer regardless of gating.
    expect(src).toContain('if (!isPreviewInboxEnabled() || !TYPING_CONVERSATION_ID) return () => {};');
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  canSaveNickname, cleanParam, participantFromParams, pickOtherParticipant,
  resolveConversationParticipant, type ResolveDeps,
} from '../conversationParticipant';

function deps(over: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    myIds: ['user_me', 'me'],
    getPreview: () => null,
    isPreviewId: (id) => id.startsWith('preview-'),
    isDevPreviewSession: false,
    fetchConversation: vi.fn(async () => null),
    ...over,
  };
}

describe('cleanParam', () => {
  it('treats URLSearchParams "undefined"/"null" strings as absent', () => {
    expect(cleanParam('undefined')).toBe('');
    expect(cleanParam('null')).toBe('');
    expect(cleanParam(undefined)).toBe('');
    expect(cleanParam(['abc'])).toBe('abc');
    expect(cleanParam(' Ava ')).toBe('Ava');
  });
});

describe('participantFromParams', () => {
  it('needs both an id and a name', () => {
    expect(participantFromParams({ participantUserId: 'u1', participantName: '' })).toBeNull();
    expect(participantFromParams({ participantUserId: 'undefined', participantName: 'Ava' })).toBeNull();
    expect(participantFromParams({ participantUserId: 'u1', participantName: 'Ava', participantNickname: '' }))
      .toEqual({ userId: 'u1', name: 'Ava' });
  });
});

describe('pickOtherParticipant', () => {
  it('skips the viewer regardless of participant order', () => {
    const conv = { participants: [
      { userId: 'user_me', name: 'Me' },
      { userId: 'u2', name: 'Kuro Line', nickname: 'K' },
    ] };
    expect(pickOtherParticipant(conv, ['user_me'])).toEqual({ userId: 'u2', name: 'Kuro Line', nickname: 'K' });
  });
  it('falls back to handle, and returns null with no usable name', () => {
    expect(pickOtherParticipant({ participants: [{ userId: 'u2', name: '', handle: 'kuro' }] }, [])?.name).toBe('kuro');
    expect(pickOtherParticipant({ participants: [{ userId: 'u2', name: 'undefined' }] }, [])).toBeNull();
    expect(pickOtherParticipant(null, [])).toBeNull();
  });
});

describe('resolveConversationParticipant', () => {
  it('is not-found with no conversation id (direct load) — never "undefined"', async () => {
    const d = deps();
    expect(await resolveConversationParticipant({}, d)).toEqual({ status: 'not-found' });
    expect(await resolveConversationParticipant({ id: 'undefined', participantName: 'undefined' }, d))
      .toEqual({ status: 'not-found' });
    expect(d.fetchConversation).not.toHaveBeenCalled();
  });

  it('uses params when the opener passed them', async () => {
    const d = deps();
    expect(await resolveConversationParticipant({ id: 'c1', participantUserId: 'u2', participantName: 'Ava' }, d))
      .toEqual({ status: 'ready', participant: { userId: 'u2', name: 'Ava' } });
    expect(d.fetchConversation).not.toHaveBeenCalled();
  });

  it('loads the other participant from the conversation when params are missing', async () => {
    const d = deps({
      fetchConversation: vi.fn(async () => ({ participants: [
        { userId: 'user_me', name: 'Me' }, { userId: 'u9', name: 'Orison', nickname: 'Ori' },
      ] })),
    });
    expect(await resolveConversationParticipant({ id: 'c1' }, d))
      .toEqual({ status: 'ready', participant: { userId: 'u9', name: 'Orison', nickname: 'Ori' } });
  });

  it('uses the seeded preview inbox for preview ids / dev-preview sessions without hitting the network', async () => {
    const d = deps({ getPreview: () => ({ participants: [{ userId: 'p1', name: 'Studio' }] }) });
    expect(await resolveConversationParticipant({ id: 'preview-conversation-1' }, d))
      .toEqual({ status: 'ready', participant: { userId: 'p1', name: 'Studio' } });
    const d2 = deps({ isDevPreviewSession: true });
    expect(await resolveConversationParticipant({ id: 'some-other-id' }, d2)).toEqual({ status: 'not-found' });
    expect(d.fetchConversation).not.toHaveBeenCalled();
    expect(d2.fetchConversation).not.toHaveBeenCalled();
  });

  it('maps 404/403 to not-found and other failures to error', async () => {
    const fail = (status?: number) => deps({ fetchConversation: vi.fn(async () => { throw Object.assign(new Error('x'), { status }); }) });
    expect(await resolveConversationParticipant({ id: 'c1' }, fail(404))).toEqual({ status: 'not-found' });
    expect(await resolveConversationParticipant({ id: 'c1' }, fail(403))).toEqual({ status: 'not-found' });
    expect(await resolveConversationParticipant({ id: 'c1' }, fail(500))).toEqual({ status: 'error' });
    expect(await resolveConversationParticipant({ id: 'c1' }, fail(undefined))).toEqual({ status: 'error' });
  });
});

describe('canSaveNickname', () => {
  it('is disabled for an empty field with no existing nickname, and when unchanged', () => {
    expect(canSaveNickname('', undefined)).toBe(false);
    expect(canSaveNickname('   ', '')).toBe(false);
    expect(canSaveNickname('Ori', 'Ori')).toBe(false);
    expect(canSaveNickname('Ori ', 'Ori')).toBe(false);
  });
  it('is enabled for a new value, or for clearing an existing nickname', () => {
    expect(canSaveNickname('Ori', undefined)).toBe(true);
    expect(canSaveNickname('', 'Ori')).toBe(true);
  });
});

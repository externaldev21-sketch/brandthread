/**
 * lib/requestActions.ts is the single seam that decides "real API" vs
 * "preview-cache mutator" for the three message-request actions. This is
 * exactly the branch the app owner's bug report was missing — the old
 * inbox.tsx `acceptRequest` called `api.conversations.accept()`
 * unconditionally, so every seeded preview request (id like
 * `preview-conversation-03`) 404'd against the real backend. These tests
 * assert the branch exists and goes the right way for both a real and a
 * preview conversation id, with lib/previewInbox.ts and
 * services/socialService.ts mocked out (both pull in bundled image assets /
 * react-native transitively — see tests/buyer-inbox.test.tsx's own note on
 * why previewInbox.ts can't be imported for real under Vitest).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { acceptPreviewMock, deletePreviewMock, blockUserMock, isPreviewIdMock } = vi.hoisted(() => ({
  acceptPreviewMock: vi.fn(),
  deletePreviewMock: vi.fn(),
  blockUserMock: vi.fn(),
  isPreviewIdMock: vi.fn((id: string) => id.startsWith('preview-conversation-')),
}));

vi.mock('@/lib/previewInbox', () => ({
  isPreviewConversationId: isPreviewIdMock,
  acceptPreviewConversationRequest: acceptPreviewMock,
  deletePreviewConversationRequest: deletePreviewMock,
}));
vi.mock('@/services/socialService', () => ({
  blockUser: blockUserMock,
}));

const {
  acceptConversationRequest, scheduleDeleteConversationRequest, undoDeleteConversationRequest,
  blockConversationRequestUser,
} = await import('@/lib/requestActions');
const { __resetPendingConversationDeletesForTests } = await import('@/lib/pendingRequestDeletes');

function fakeApi() {
  return {
    conversations: {
      accept: vi.fn().mockResolvedValue({}),
      decline: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  __resetPendingConversationDeletesForTests();
});

describe('acceptConversationRequest', () => {
  it('a preview conversation id goes through the local preview mutator, never the real API', async () => {
    const api = fakeApi();
    await acceptConversationRequest('preview-conversation-03', api);
    expect(acceptPreviewMock).toHaveBeenCalledWith('preview-conversation-03');
    expect(api.conversations.accept).not.toHaveBeenCalled();
  });

  it('a real conversation id calls the real API, never the preview mutator', async () => {
    const api = fakeApi();
    await acceptConversationRequest('real-conv-42', api);
    expect(api.conversations.accept).toHaveBeenCalledWith('real-conv-42');
    expect(acceptPreviewMock).not.toHaveBeenCalled();
  });
});

describe('scheduleDeleteConversationRequest / undoDeleteConversationRequest', () => {
  it('defers the preview delete behind the undo window, and undo cancels it', () => {
    const api = fakeApi();
    scheduleDeleteConversationRequest('preview-conversation-08', api);
    expect(deletePreviewMock).not.toHaveBeenCalled();
    undoDeleteConversationRequest('preview-conversation-08');
    vi.advanceTimersByTime(10_000);
    expect(deletePreviewMock).not.toHaveBeenCalled();
    expect(api.conversations.decline).not.toHaveBeenCalled();
  });

  it('commits a preview delete via the preview mutator once the window elapses', () => {
    const api = fakeApi();
    scheduleDeleteConversationRequest('preview-conversation-08', api);
    vi.advanceTimersByTime(4000);
    expect(deletePreviewMock).toHaveBeenCalledWith('preview-conversation-08');
    expect(api.conversations.decline).not.toHaveBeenCalled();
  });

  it('commits a real delete via the real API (decline/hard-delete endpoint) once the window elapses', async () => {
    const api = fakeApi();
    scheduleDeleteConversationRequest('real-conv-42', api);
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.conversations.decline).toHaveBeenCalledWith('real-conv-42');
    expect(deletePreviewMock).not.toHaveBeenCalled();
  });
});

describe('blockConversationRequestUser', () => {
  const subject = { userId: 'u1', name: 'Saint Rue', handle: '@saint_rue', initials: 'SR', color: '#111827' };

  it('a preview conversation removes the seeded request locally without calling the real block API', async () => {
    await blockConversationRequestUser('preview-conversation-03', subject);
    expect(deletePreviewMock).toHaveBeenCalledWith('preview-conversation-03');
    expect(blockUserMock).not.toHaveBeenCalled();
  });

  it('a real conversation calls the real block API', async () => {
    await blockConversationRequestUser('real-conv-42', subject);
    expect(blockUserMock).toHaveBeenCalledWith(subject);
    expect(deletePreviewMock).not.toHaveBeenCalled();
  });
});

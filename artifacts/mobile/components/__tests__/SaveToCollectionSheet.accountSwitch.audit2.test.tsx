/**
 * Audit regression: after an account switch while the sheet is open, the
 * reload for the new account fails — the previous account's collections must
 * not stay listed under the new account.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { auth, getCollections } = vi.hoisted(() => ({
  auth: { userId: 'u1' as string | null },
  getCollections: vi.fn(),
}));

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: !!auth.userId, userId: auth.userId }) }));
vi.mock('@/services/socialService', () => ({
  getCollections: (...a: unknown[]) => getCollections(...a),
  createCollection: vi.fn(), saveItem: vi.fn(), moveSavedItemToCollection: vi.fn(),
}));

const { SaveToCollectionSheet } = await import('../SaveToCollectionSheet');

function texts(r: ReactTestRenderer): string[] {
  return r.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));
}

const ITEM = { type: 'product' as const, targetId: 'p1', title: 'Jacket' };

describe('SaveToCollectionSheet — account switch with failed reload', () => {
  it("does not keep listing the previous account's collections", async () => {
    getCollections.mockResolvedValueOnce([
      { id: 'c1', name: 'Old Account Board', updatedAt: '2024-01-01', itemCount: 1, isPublic: false },
    ]);
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<SaveToCollectionSheet visible item={ITEM} onClose={() => {}} />); });
    expect(texts(r)).toContain('Old Account Board');

    getCollections.mockRejectedValueOnce(new Error('offline'));
    auth.userId = 'u2';
    await act(async () => { r.update(<SaveToCollectionSheet visible item={ITEM} onClose={() => {}} />); });
    expect(texts(r)).toContain("Couldn't load your collections.");
    expect(texts(r)).not.toContain('Old Account Board');
    r.unmount();
  });
});

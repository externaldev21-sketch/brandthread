import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { allShareTargets, filterShareTargets } from '@/lib/shareContactSearch';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/ui/Input', () => ({ Input: (p: any) => React.createElement('Input', p) }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: (p: any) => React.createElement('EmptyState', p, p.title) }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: (p: any) => React.createElement('ErrorState', p, p.message) }));
vi.mock('@/components/ui/Skeleton', () => ({ SkeletonBlock: () => null, SkeletonLine: () => null }));
vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: () => ({ theme: { text: '#fff', muted: '#888', onAccent: '#000', border: '#333' } }) }));

const { ShareContactPicker } = await import('../components/ShareContactPicker');

const conv = (id: string, userId: string, name: string, ts: number) => ({
  id, isRequest: false, isOfficial: false, lastMessageTs: ts,
  participants: [{ userId: 'me' }, { userId, name, handle: name.toLowerCase(), initials: name[0], color: '#111', accountType: 'buyer' }],
}) as any;
const friend = (userId: string, name: string) => ({ userId, name, handle: name.toLowerCase(), initials: name[0], color: '#222' }) as any;

describe('share contact search', () => {
  const many = Array.from({ length: 25 }, (_, i) => friend(`f${i}`, `Friend${i}`));
  const all = allShareTargets([conv('c1', 'u1', 'Alex', 2), conv('c2', 'u2', 'Sam', 5)], [friend('u1', 'Alex'), ...many], 'me');

  it('includes every conversation and friend, not just the recent slice, deduped', () => {
    expect(all.length).toBe(27);
    expect(all[0].userId).toBe('u2');
    expect(all.find(t => t.userId === 'u1')?.conversationId).toBe('c1');
  });

  it('filters by name or @handle, case-insensitive', () => {
    expect(filterShareTargets(all, '@SAM').map(t => t.userId)).toEqual(['u2']);
    expect(filterShareTargets(all, 'friend24').map(t => t.userId)).toEqual(['f24']);
    expect(filterShareTargets(all, '  ')).toHaveLength(27);
  });

  it('renders a virtualized list and routes taps through onSend', async () => {
    const onSend = vi.fn();
    let t!: ReactTestRenderer;
    await act(async () => { t = create(<ShareContactPicker status="ready" targets={all} busyUserId={null} onSend={onSend} onBack={() => {}} onRetry={() => {}} />); });
    expect(t.root.findAll(n => n.type === ('FlatList' as any)).length).toBe(1);
    const input = t.root.find(n => n.props.testID === 'share-contacts-search' && n.props.onChangeText);
    await act(async () => { input.props.onChangeText('sam'); });
    const row = t.root.find(n => n.props.testID === 'share-contact-u2' && n.props.onPress);
    row.props.onPress();
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', conversationId: 'c2' }));
    expect(t.root.findAll(n => n.props.testID === 'share-contact-f3' && n.props.onPress)).toHaveLength(0);
  });

  it('shows honest signed-out, error and empty states', async () => {
    let t!: ReactTestRenderer;
    const onRetry = vi.fn();
    await act(async () => { t = create(<ShareContactPicker status="signed_out" targets={[]} busyUserId={null} onSend={() => {}} onBack={() => {}} onRetry={onRetry} />); });
    expect(t.root.findAll(n => n.props.testID === 'share-contacts-signed-out').length).toBeGreaterThan(0);
    expect(t.root.findAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith('share-contact-u')).length).toBe(0);
    await act(async () => { t.update(<ShareContactPicker status="error" targets={[]} busyUserId={null} onSend={() => {}} onBack={() => {}} onRetry={onRetry} />); });
    t.root.find(n => n.type === ('ErrorState' as any)).props.onRetry();
    expect(onRetry).toHaveBeenCalled();
    await act(async () => { t.update(<ShareContactPicker status="ready" targets={[]} busyUserId={null} onSend={() => {}} onBack={() => {}} onRetry={onRetry} />); });
    expect(t.root.findAll(n => n.props.testID === 'share-contacts-empty').length).toBeGreaterThan(0);
  });

  it('sheet wires the picker to the same sendToFriend and has no generic friends route', () => {
    const sheet = readFileSync(resolve(process.cwd(), 'components/ThreadShareSheet.tsx'), 'utf8');
    expect(sheet).toContain('onSend={target => void sendToFriend(target)}');
    expect(sheet).toContain('onPress={() => setPickerOpen(true)}');
    expect(sheet).not.toContain('/(buyer)/friends');
    expect(sheet).toContain("if (!myUserId) { setContactStatus('signed_out'); return; }");
  });
});

import { describe, expect, it, vi } from 'vitest';

const { alert } = vi.hoisted(() => ({ alert: vi.fn() }));
vi.mock('react-native', () => ({ Alert: { alert } }));

import { BLOCK_EXPLAINER, confirmBlock, confirmUnblock, type ConfirmPresenter } from '../lib/safety';

type Buttons = Parameters<ConfirmPresenter>[2];

describe('confirmBlock', () => {
  it('uses the native Alert by default and blocks on confirm', async () => {
    alert.mockClear();
    const block = vi.fn(async () => ({ ok: true }));
    const pending = confirmBlock({ userId: 'user_2', name: 'Maya' }, block);
    const [title, message, buttons, options] = alert.mock.calls[0];
    expect(title).toBe('Block Maya?');
    expect(message).toBe(BLOCK_EXPLAINER);
    expect(options).toMatchObject({ cancelable: true });
    await (buttons as Buttons).find((b) => b.text === 'Block')!.onPress!();
    await expect(pending).resolves.toBe(true);
    expect(block).toHaveBeenCalledWith('user_2');
  });

  it('routes through a custom presenter (web sheet) and resolves false on Cancel', async () => {
    alert.mockClear();
    let shown: Buttons = [];
    const present: ConfirmPresenter = (_t, _m, buttons) => { shown = buttons; };
    const block = vi.fn();
    const pending = confirmBlock({ userId: 'user_2', name: 'Maya' }, block, present);
    expect(alert).not.toHaveBeenCalled();
    shown.find((b) => b.style === 'cancel')!.onPress!();
    await expect(pending).resolves.toBe(false);
    expect(block).not.toHaveBeenCalled();
  });

  it('reports a failed block through the same presenter and resolves false', async () => {
    const calls: string[] = [];
    let shown: Buttons = [];
    const present: ConfirmPresenter = (title, _m, buttons) => { calls.push(title); shown = buttons; };
    const pending = confirmBlock({ userId: 'user_2', name: 'Maya' }, async () => { throw new Error('offline'); }, present);
    await shown.find((b) => b.text === 'Block')!.onPress!();
    await expect(pending).resolves.toBe(false);
    expect(calls).toEqual(['Block Maya?', 'Couldn’t block']);
  });

  it('Unblock also accepts a presenter (Settings › Blocked accounts on web)', async () => {
    alert.mockClear();
    let shown: Buttons = [];
    const present: ConfirmPresenter = (_t, _m, buttons) => { shown = buttons; };
    const unblock = vi.fn(async () => ({ ok: true }));
    const pending = confirmUnblock({ userId: 'user_2', name: 'Maya' }, unblock, present);
    expect(alert).not.toHaveBeenCalled();
    await shown.find((b) => b.text === 'Unblock')!.onPress!();
    await expect(pending).resolves.toBe(true);
    expect(unblock).toHaveBeenCalledWith('user_2');
  });
});

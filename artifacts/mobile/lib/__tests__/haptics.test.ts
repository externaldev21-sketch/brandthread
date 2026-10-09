import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Rigid: 'rigid', Soft: 'soft' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  selectionAsync: () => { calls.push('selection'); return Promise.resolve(); },
  impactAsync: (s: string) => { calls.push(`impact:${s}`); return Promise.resolve(); },
  notificationAsync: (t: string) => { calls.push(`notification:${t}`); return Promise.resolve(); },
}));

async function load() {
  vi.resetModules();
  return import('../haptics');
}

describe('haptics map (Apple HIG "Playing haptics")', () => {
  beforeEach(() => { calls.length = 0; process.env.EXPO_OS = 'ios'; });

  it('maps each meaning to exactly one native pattern', async () => {
    const { haptics } = await load();
    haptics.selection();
    haptics.light();
    haptics.success();
    haptics.warning();
    haptics.error();
    haptics.rigid();
    expect(calls).toEqual([
      'selection',
      'impact:light',
      'notification:success',
      'notification:warning',
      'notification:error',
      'impact:rigid',
    ]);
  });

  it('is silent on web', async () => {
    process.env.EXPO_OS = 'web';
    const { haptics } = await load();
    haptics.light();
    haptics.success();
    expect(calls).toEqual([]);
  });

  it('never throws or rejects when the native call fails', async () => {
    const mod = await import('expo-haptics');
    const spy = vi.spyOn(mod, 'impactAsync').mockImplementation(() => Promise.reject(new Error('no engine')));
    const { haptics } = await load();
    expect(() => haptics.light()).not.toThrow();
    spy.mockRestore();
  });

  it('keeps the tab-bar legacy names on their original feel', async () => {
    const { hapticTabChange, hapticLight } = await load();
    hapticTabChange();
    hapticLight();
    expect(calls).toEqual(['impact:medium', 'impact:light']);
  });
});

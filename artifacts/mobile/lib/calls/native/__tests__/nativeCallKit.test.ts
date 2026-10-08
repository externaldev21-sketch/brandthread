import { describe, expect, it, vi } from 'vitest';

const rn = vi.hoisted(() => ({
  NativeModules: {} as Record<string, unknown>,
  Platform: { OS: 'ios' },
  Settings: { values: {} as Record<string, unknown>, set(v: Record<string, unknown>) { Object.assign(this.values, v); } },
}));
vi.mock('react-native', () => rn);
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { storage.set(k, v); },
    removeItem: async (k: string) => { storage.delete(k); },
  },
}));

import {
  inertNativeCallKit,
  loadOptionalNative,
  nativeCallsFlagEnabled,
  nativeEndReasonFor,
  nativeEndReasonForSession,
  nativeRingDecision,
  parseNativeCallPush,
} from '../nativeCallCore';
import { CALL_USER_ID_KEY, getCallUserId, setCallUserId } from '../callIdentity';

const CALL = '11111111-2222-4333-8444-555555555555';

describe('parseNativeCallPush', () => {
  it('reads an APNs VoIP payload', () => {
    expect(parseNativeCallPush({
      type: 'dm_call_incoming', callId: CALL.toUpperCase(), conversationId: 'conv-1', callerId: 'u1',
      callerName: 'Ava Stone', callerAvatar: 'https://img/a.jpg', hasVideo: true,
    })).toEqual({
      type: 'dm_call_incoming', callId: CALL, conversationId: 'conv-1', calleeId: null, callerId: 'u1',
      callerName: 'Ava Stone', callerAvatar: 'https://img/a.jpg', hasVideo: true, reason: null,
    });
    expect(parseNativeCallPush({ type: 'dm_call_incoming', callId: CALL, calleeId: 'user_b' })).toMatchObject({ calleeId: 'user_b' });
  });

  it('reads an FCM data map (string values) and a JSON string', () => {
    const fcm = { type: 'dm_call_ended', callId: CALL, callerName: 'Ava', callerAvatar: '', hasVideo: '0', reason: 'cancelled' };
    expect(parseNativeCallPush(fcm)).toMatchObject({ type: 'dm_call_ended', hasVideo: false, callerAvatar: null, reason: 'cancelled' });
    expect(parseNativeCallPush(JSON.stringify({ ...fcm, hasVideo: '1' }))).toMatchObject({ hasVideo: true });
  });

  it('ignores anything that is not a DM call push', () => {
    expect(parseNativeCallPush(null)).toBeNull();
    expect(parseNativeCallPush('{oops')).toBeNull();
    expect(parseNativeCallPush({ type: 'new_message', callId: CALL })).toBeNull();
    expect(parseNativeCallPush({ type: 'dm_call_incoming', callId: 'not-a-uuid' })).toBeNull();
    expect(parseNativeCallPush({ type: 'dm_call_incoming', callId: CALL })).toMatchObject({ callerName: 'Brandthread' });
  });
});

describe('nativeRingDecision — only ring for the account signed in on this device', () => {
  it('rings when the push is for the signed-in user', () => {
    expect(nativeRingDecision('user_a', 'user_a')).toBe('ring');
  });
  it('rejects a push for the previous account after switching accounts', () => {
    expect(nativeRingDecision('user_a', 'user_b')).toBe('reject');
  });
  it('rejects every push while signed out', () => {
    expect(nativeRingDecision('user_a', null)).toBe('reject');
    expect(nativeRingDecision(null, null)).toBe('reject');
    expect(nativeRingDecision('user_a', '')).toBe('reject');
  });
  it('trusts a push without calleeId (older server) only when someone is signed in', () => {
    expect(nativeRingDecision(null, 'user_a')).toBe('ring');
  });
});

describe('callIdentity', () => {
  it('persists the signed-in id for the native handlers and clears it on sign-out', async () => {
    rn.Platform.OS = 'ios';
    await setCallUserId('user_a');
    expect(await getCallUserId()).toBe('user_a');
    expect(rn.Settings.values[CALL_USER_ID_KEY]).toBe('user_a'); // NSUserDefaults, read by AppDelegate.swift
    await setCallUserId(null);
    expect(await getCallUserId()).toBeNull();
    expect(rn.Settings.values[CALL_USER_ID_KEY]).toBe('');
  });
});

describe('end reasons', () => {
  it('maps server reasons to CallKit / ConnectionService reasons', () => {
    expect(nativeEndReasonFor('answered_elsewhere')).toBe('answeredElsewhere');
    expect(nativeEndReasonFor('declined')).toBe('declinedElsewhere');
    expect(nativeEndReasonFor('missed')).toBe('unanswered');
    expect(nativeEndReasonFor('cancelled')).toBe('remoteEnded');
    expect(nativeEndReasonFor('blocked')).toBe('remoteEnded');
    expect(nativeEndReasonForSession('failed', false)).toBe('failed');
    expect(nativeEndReasonForSession('hangup', true)).toBe('remoteEnded');
  });
});

describe('safe fallbacks (Expo Go / web / missing native module)', () => {
  it('loadOptionalNative returns null when the native module is absent or the require throws', () => {
    const load = vi.fn(() => ({ default: { ok: true } }));
    expect(loadOptionalNative(load, () => false)).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(loadOptionalNative(() => { throw new Error('Cannot find module'); }, () => true)).toBeNull();
    expect(loadOptionalNative(load, () => true)).toEqual({ ok: true });
  });

  it('the kill switch reads EXPO_PUBLIC_NATIVE_CALLS', () => {
    expect(nativeCallsFlagEnabled(undefined)).toBe(true);
    expect(nativeCallsFlagEnabled('0')).toBe(false);
    expect(nativeCallsFlagEnabled('false')).toBe(false);
  });

  it('the inert implementation never throws', () => {
    const off = inertNativeCallKit.init({ onAnswer: vi.fn(), onEnd: vi.fn(), onPush: vi.fn() });
    expect(() => off()).not.toThrow();
    const upload = vi.fn();
    inertNativeCallKit.registerToken(upload)();
    inertNativeCallKit.reportAnswered(CALL);
    inertNativeCallKit.endCall(CALL, 'remoteEnded');
    expect(upload).not.toHaveBeenCalled();
    expect(inertNativeCallKit.available).toBe(false);
  });

  it('default (web) module is inert', async () => {
    const { nativeCallKit } = await import('../nativeCallKit');
    expect(nativeCallKit.available).toBe(false);
  });

  it('iOS module is inert without RNCallKeep / RNVoipPushNotificationManager native modules (Expo Go)', async () => {
    rn.NativeModules = {};
    const { nativeCallKit } = await import('../nativeCallKit.ios');
    expect(nativeCallKit.available).toBe(false);
  });

  it('Android module and headless task are inert without RNCallKeep', async () => {
    rn.NativeModules = {};
    rn.Platform.OS = 'android';
    const { nativeCallKit } = await import('../nativeCallKit.android');
    expect(nativeCallKit.available).toBe(false);
    await expect(import('../registerBackgroundCallTask.android')).resolves.toMatchObject({ CALL_PUSH_TASK: 'brandthread-dm-call-push' });
  });
});

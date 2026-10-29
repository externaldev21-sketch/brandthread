/**
 * Starting a voice note waits on the microphone permission prompt. If the
 * person cancels or lets go before that resolves, the recorder must not start
 * afterwards anyway (a live mic, a "recording" pill nobody is holding, and —
 * after a release — an automatic send at the 5-minute cap).
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default } };
});

let grant!: (v: { granted: boolean }) => void;
const recorder = {
  prepareToRecordAsync: vi.fn(async () => {}),
  record: vi.fn(),
  stop: vi.fn(async () => {}),
  getStatus: vi.fn(() => ({ url: null, durationMillis: 0 })),
  uri: null,
};
vi.mock('expo-audio', () => ({
  useAudioRecorder: () => recorder,
  useAudioRecorderState: () => ({ isRecording: false, metering: undefined }),
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: () => new Promise((resolve) => { grant = resolve; }),
  setAudioModeAsync: vi.fn(async () => {}),
}));

import { useVoiceRecorder } from './useVoiceRecorder';

type Hook = ReturnType<typeof useVoiceRecorder>;

async function flush() { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); }

function setup() {
  let hook!: Hook;
  const onRecorded = vi.fn();
  function Probe() { hook = useVoiceRecorder(async () => 'https://cdn.test/a.m4a', onRecorded); return null; }
  let r!: ReturnType<typeof create>;
  act(() => { r = create(<Probe />); });
  return { get: () => hook, onRecorded, unmount: () => act(() => r.unmount()) };
}

describe('useVoiceRecorder start race', () => {
  it('does not start recording when cancelled during the permission prompt', async () => {
    recorder.record.mockClear();
    const h = setup();
    let started: Promise<void> | undefined;
    act(() => { started = h.get().startWeb(); });
    act(() => { h.get().cancel(); });
    grant({ granted: true });
    await flush();
    await started;
    expect(recorder.record).not.toHaveBeenCalled();
    expect(h.get().phase).toBe('idle');
    h.unmount();
  });

  it('does not start recording when finished (released) during the permission prompt', async () => {
    recorder.record.mockClear();
    const h = setup();
    let started: Promise<void> | undefined;
    act(() => { started = h.get().startWeb(); });
    let finished: unknown = 'pending';
    await act(async () => { finished = await h.get().finish(); });
    grant({ granted: true });
    await flush();
    await started;
    expect(finished).toBeNull();
    expect(recorder.record).not.toHaveBeenCalled();
    expect(h.get().phase).toBe('idle');
    expect(h.onRecorded).not.toHaveBeenCalled();
    h.unmount();
  });
});

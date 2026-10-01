import { describe, expect, it } from 'vitest';
import {
  CAPTURE_CHIPS, CHIP_SECONDS, DEFAULT_CHIP,
  chipsForMode, coerceChipForMode, createModeOptions, formatRecordingTime,
  nearestChipIndex, nextTimerSetting, recordingProgress, shouldAutoStop,
} from '../lib/createCamera';

describe('createCamera helpers', () => {
  it('offers the TikTok duration chips in order with Photo last', () => {
    expect(CAPTURE_CHIPS).toEqual(['10m', '60s', '30s', '15s', 'photo']);
    expect(CHIP_SECONDS['10m']).toBe(600);
    expect(CHIP_SECONDS['60s']).toBe(60);
    expect(CHIP_SECONDS['30s']).toBe(30);
    expect(CHIP_SECONDS['15s']).toBe(15);
    expect(CHIP_SECONDS.photo).toBe(0);
    expect(CAPTURE_CHIPS).toContain(DEFAULT_CHIP);
  });

  it('sellers choose Thread / Post / Story; buyers only Post / Story', () => {
    expect(createModeOptions(false)).toEqual(['thread', 'post', 'story']);
    expect(createModeOptions(true)).toEqual(['post', 'story']);
  });

  it('Post mode is photo-only and coerces a video chip to Photo', () => {
    expect(chipsForMode('post')).toEqual(['photo']);
    expect(chipsForMode('thread')).toEqual(CAPTURE_CHIPS);
    expect(coerceChipForMode('60s', 'post')).toBe('photo');
    expect(coerceChipForMode('60s', 'thread')).toBe('60s');
    expect(coerceChipForMode('photo', 'thread')).toBe('photo');
  });

  it('timer cycles off → 3s → 10s → off', () => {
    expect(nextTimerSetting(0)).toBe(3);
    expect(nextTimerSetting(3)).toBe(10);
    expect(nextTimerSetting(10)).toBe(0);
  });

  it('fills the progress ring by the selected max length and auto-stops at it', () => {
    expect(recordingProgress(0, '15s')).toBe(0);
    expect(recordingProgress(7.5, '15s')).toBe(0.5);
    expect(recordingProgress(30, '15s')).toBe(1);
    expect(recordingProgress(300, '10m')).toBe(0.5);
    expect(recordingProgress(5, 'photo')).toBe(0);
    expect(shouldAutoStop(14.9, '15s')).toBe(false);
    expect(shouldAutoStop(15, '15s')).toBe(true);
    expect(shouldAutoStop(600, '10m')).toBe(true);
    expect(shouldAutoStop(99, 'photo')).toBe(false);
  });

  it('formats the recording readout as mm:ss', () => {
    expect(formatRecordingTime(0)).toBe('00:00');
    expect(formatRecordingTime(5.9)).toBe('00:05');
    expect(formatRecordingTime(600)).toBe('10:00');
    expect(formatRecordingTime(-3)).toBe('00:00');
  });

  it('snaps a swiped chip row to the nearest chip', () => {
    expect(nearestChipIndex(0, 64, 5)).toBe(0);
    expect(nearestChipIndex(70, 64, 5)).toBe(1);
    expect(nearestChipIndex(1000, 64, 5)).toBe(4);
    expect(nearestChipIndex(-20, 64, 5)).toBe(0);
    expect(nearestChipIndex(50, 0, 5)).toBe(0);
  });
});

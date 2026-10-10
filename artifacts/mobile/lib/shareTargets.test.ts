import { describe, expect, it } from 'vitest';
import { SHARE_TARGETS, shareTargetUrls } from './shareTargets';

const link = 'https://brandthread.app/@northline';

describe('share targets', () => {
  it('is the Dev-specified row, in order', () => {
    expect(SHARE_TARGETS.map((t) => t.label)).toEqual(['Messages', 'Instagram', 'TikTok', 'WhatsApp', 'Snapchat', 'More']);
  });
  it('puts the link straight into Messages and WhatsApp', () => {
    expect(shareTargetUrls('messages', link, 'ios')).toEqual([`sms:&body=${encodeURIComponent(link)}`]);
    expect(shareTargetUrls('messages', link, 'android')).toEqual([`sms:?body=${encodeURIComponent(link)}`]);
    expect(shareTargetUrls('whatsapp', link, 'ios')[0]).toBe(`whatsapp://send?text=${encodeURIComponent(link)}`);
    expect(shareTargetUrls('whatsapp', link, 'web')).toEqual([`https://wa.me/?text=${encodeURIComponent(link)}`]);
  });
  it('copies first for apps without a link-share URL, and opens them', () => {
    for (const k of ['instagram', 'tiktok', 'snapchat'] as const) {
      expect(SHARE_TARGETS.find((t) => t.key === k)?.copyFirst).toBe(true);
      expect(shareTargetUrls(k, link, 'ios').length).toBeGreaterThan(0);
    }
  });
  it('falls back to the system share sheet where nothing can open', () => {
    expect(shareTargetUrls('more', link, 'ios')).toEqual([]);
    expect(shareTargetUrls('instagram', link, 'web')).toEqual([]);
    expect(shareTargetUrls('messages', link, 'web')).toEqual([]);
  });
});

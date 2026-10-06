/**
 * Human device label from a browser user agent, e.g. "iPhone · Safari",
 * "Mac · Chrome", "Android · Chrome". Used where the app only knows "this
 * browser tab" (the dev preview's current session) so a row can name the
 * device instead of repeating "This device" next to the "This device" badge.
 */
export function deviceLabelFromUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;

  let device: string | null = null;
  if (/iPad/i.test(ua)) device = 'iPad';
  else if (/iPhone|iPod/i.test(ua)) device = 'iPhone';
  else if (/Android/i.test(ua)) device = /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/Macintosh|Mac OS X/i.test(ua)) device = 'Mac';
  else if (/Windows/i.test(ua)) device = 'Windows PC';
  else if (/CrOS/i.test(ua)) device = 'Chromebook';
  else if (/Linux/i.test(ua)) device = 'Linux';

  // Order matters: Edge/Opera/Chrome-on-iOS all also contain "Safari"/"Chrome".
  let browser: string | null = null;
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  const parts = [device, browser].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

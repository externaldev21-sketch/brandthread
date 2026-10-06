/**
 * Human-readable device + browser names from a user-agent string, used to
 * title the current session in Login activity (e.g. "iPhone" / "Safari")
 * instead of a generic "This device" label.
 */
export interface DeviceDescription {
  device: string;
  browser: string | null;
  isMobile: boolean;
}

export function describeUserAgent(ua: string | null | undefined): DeviceDescription {
  const s = ua ?? '';
  let device = 'Web browser';
  let isMobile = false;
  if (/iPad/i.test(s)) { device = 'iPad'; isMobile = true; }
  else if (/iPhone|iPod/i.test(s)) { device = 'iPhone'; isMobile = true; }
  else if (/Android/i.test(s)) { device = /Mobile/i.test(s) ? 'Android phone' : 'Android tablet'; isMobile = true; }
  else if (/Macintosh|Mac OS X/i.test(s)) device = 'Mac';
  else if (/Windows/i.test(s)) device = 'Windows PC';
  else if (/CrOS/i.test(s)) device = 'Chromebook';
  else if (/Linux/i.test(s)) device = 'Linux PC';

  let browser: string | null = null;
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Firefox\/|FxiOS/i.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';

  return { device, browser, isMobile };
}

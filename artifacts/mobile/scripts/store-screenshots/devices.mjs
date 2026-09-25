/**
 * Store screenshot sizes. Each device renders the web build at a CSS
 * viewport that, multiplied by `scale`, gives the exact pixel size the store
 * asks for.
 *
 * App Store (App Store Connect → Previews and Screenshots):
 *   - 6.9" iPhone display: 1320 × 2868 portrait (required for iPhone apps).
 *   - 13" iPad display:    2064 × 2752 portrait (required because the app
 *     supports iPad, `ios.supportsTablet: true`).
 * Google Play (Play Console → Main store listing → Graphics):
 *   - Phone: 1080 × 1920 (9:16, the size Play recommends for featuring).
 *   - 7" tablet: 1200 × 1920. 10" tablet: 1600 × 2560.
 *   Play accepts 320–3840 px per side with the long side at most twice the
 *   short side; all three sizes fit.
 */

export const DEVICES = [
  {
    id: 'iphone-6.9in',
    store: 'App Store',
    field: 'iPhone 6.9" Display',
    viewport: { width: 440, height: 956 },
    scale: 3,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
  },
  {
    id: 'ipad-13in',
    store: 'App Store',
    field: 'iPad 13" Display',
    viewport: { width: 1032, height: 1376 },
    scale: 2,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
  },
  {
    id: 'android-phone',
    store: 'Google Play',
    field: 'Phone screenshots',
    viewport: { width: 360, height: 640 },
    scale: 3,
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    isMobile: true,
  },
  {
    id: 'android-tablet-7in',
    store: 'Google Play',
    field: '7-inch tablet screenshots',
    viewport: { width: 600, height: 960 },
    scale: 2,
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    isMobile: true,
  },
  {
    id: 'android-tablet-10in',
    store: 'Google Play',
    field: '10-inch tablet screenshots',
    viewport: { width: 800, height: 1280 },
    scale: 2,
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    isMobile: true,
  },
];

export function pixelSize(device) {
  return { width: device.viewport.width * device.scale, height: device.viewport.height * device.scale };
}

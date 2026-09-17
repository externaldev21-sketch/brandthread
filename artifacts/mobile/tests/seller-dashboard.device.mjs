const endpoint = process.env.APPIUM_SERVER_URL;
const requestedPlatform = (process.env.NATIVE_SELLER_DASHBOARD_PLATFORM ?? 'ios').toLowerCase();
const required =
  process.env.NATIVE_SELLER_DASHBOARD_REQUIRED === '1' ||
  (requestedPlatform === 'android' && process.env.NATIVE_SELLER_DASHBOARD_ANDROID_REQUIRED === '1');
const bundleId = process.env.NATIVE_APP_ID ?? 'com.brandthread.mobile';
const isAndroid = requestedPlatform === 'android';

if (!endpoint) {
  if (required) throw new Error('APPIUM_SERVER_URL is required by the native seller dashboard pipeline');
  console.log('Skipping native seller dashboard interactions: APPIUM_SERVER_URL is not configured.');
  process.exit(0);
}

const baseUrl = endpoint.replace(/\/$/, '');
let sessionId;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, body, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) {
    throw new Error(`${method} ${path}: ${JSON.stringify(result.value ?? result)}`);
  }
  return result.value;
}

async function find(label) {
  const result = await request(`/session/${sessionId}/element`, {
    using: 'accessibility id',
    value: label,
  });
  return result['element-6066-11e4-a52e-4f735466cecf'];
}

async function waitFor(label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      return await find(label);
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Timed out waiting for "${label}"`);
}

async function tap(label) {
  const element = await waitFor(label);
  await request(`/session/${sessionId}/element/${element}/click`, {});
}

async function absent(label, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await find(label);
      await sleep(100);
    } catch {
      return;
    }
  }
  throw new Error(`Expected "${label}" to disappear`);
}

async function openDashboard() {
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: deepLink',
    args: [{ url: 'brandthread://?bt_preview=seller', package: bundleId }],
  });
  await waitFor('Seller dashboard scroll');
}

async function swipeDashboard() {
  const scroll = await find('Seller dashboard scroll');
  const positionMarker = await find('Seller dashboard scroll position');
  const before = await request(`/session/${sessionId}/element/${scroll}/rect`, undefined, 'GET');
  const markerBefore = await request(
    `/session/${sessionId}/element/${positionMarker}/rect`,
    undefined,
    'GET',
  );
  const { width, height } = await request(`/session/${sessionId}/window/rect`, undefined, 'GET');
  await request(`/session/${sessionId}/actions`, {
    actions: [{
      type: 'pointer',
      id: 'seller-dashboard-scroll',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: Math.round(width / 2), y: Math.round(height * 0.78) },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 550, x: Math.round(width / 2), y: Math.round(height * 0.22) },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });
  await waitFor('Seller dashboard scroll end');
  const after = await request(`/session/${sessionId}/element/${scroll}/rect`, undefined, 'GET');
  const markerAfter = await request(
    `/session/${sessionId}/element/${positionMarker}/rect`,
    undefined,
    'GET',
  );
  if (before.height !== after.height) {
    throw new Error(`Seller dashboard scroll viewport changed size during the ${requestedPlatform} swipe`);
  }
  if (markerAfter.y >= markerBefore.y - 20) {
    throw new Error(
      `Seller dashboard content did not move after the ${requestedPlatform} swipe ` +
      `(position marker y: ${markerBefore.y} -> ${markerAfter.y})`,
    );
  }
}

async function pressAndroidBack() {
  await request(`/session/${sessionId}/back`, {});
}

async function verifyCreateRoutes() {
  const labels = ['New post', 'New product', 'New drop', 'Start a boost'];
  for (const label of labels) {
    await openDashboard();
    await tap('Create');
    for (const visibleLabel of labels) await waitFor(visibleLabel);
    await tap(label);
    await absent('New product');
  }
}

try {
  const capabilities = process.env.APPIUM_CAPABILITIES
    ? JSON.parse(process.env.APPIUM_CAPABILITIES)
    : isAndroid
      ? {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:appPackage': bundleId,
          'appium:noReset': true,
        }
      : {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:bundleId': bundleId,
        'appium:noReset': true,
      };
  if (String(capabilities.platformName).toLowerCase() !== requestedPlatform) {
    throw new Error(
      `The seller dashboard ${requestedPlatform} check received ${capabilities.platformName} capabilities`,
    );
  }
  const session = await request('/session', { capabilities: { alwaysMatch: capabilities } });
  sessionId = session.sessionId;

  await openDashboard();
  await swipeDashboard();

  await tap('Open Studio tools');
  await waitFor('Studio tools dark backdrop');
  for (const label of [
    'Design Studio',
    'Mockup to Model',
    'Remove Background',
    'AI Design',
    'Create Ad',
    'AI Photoshoot',
  ]) {
    await waitFor(label);
  }
  await tap('Dismiss Studio tools backdrop');
  await absent('Design Studio');

  await tap('Open Studio tools');
  if (isAndroid) {
    await pressAndroidBack();
  } else {
    await tap('Close Studio tools');
  }
  await absent('Design Studio');

  await tap('Open Studio tools');
  await tap('Design Studio');
  await absent('Design Studio');

  if (isAndroid) {
    await verifyCreateRoutes();
  } else {
    await openDashboard();
    await tap('Create');
    for (const label of ['New post', 'New product', 'New drop', 'Start a boost']) await waitFor(label);
    await tap('New post');
    await absent('New product');
  }

  console.log(
    `Verified ${requestedPlatform} dashboard scrolling, Studio overlay interactions, and seller create routes.`,
  );
} finally {
  if (sessionId) await request(`/session/${sessionId}`, undefined, 'DELETE').catch(() => {});
}
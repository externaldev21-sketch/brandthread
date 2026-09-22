import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const endpoint = process.env.APPIUM_SERVER_URL;
const requireDevice = process.env.NATIVE_GESTURE_REQUIRED === '1';
const bundleId = process.env.NATIVE_APP_ID ?? 'com.brandthread.mobile';
const outputDir = resolve(process.env.NATIVE_GESTURE_SCREENSHOT_DIR ?? 'test-results/navigation-gestures');
const progressPoints = [0.15, 0.35, 0.55];
const flows = [
  { name: 'card', control: 'Buyer card', axis: 'x' },
  { name: 'retained-modal', control: 'Comments modal', axis: 'y' },
];

if (!endpoint) {
  if (requireDevice) {
    throw new Error('APPIUM_SERVER_URL is required by the native gesture pipeline');
  }
  console.log('Skipping device gesture capture: APPIUM_SERVER_URL is not configured.');
  process.exit(0);
}

const baseUrl = endpoint.replace(/\/$/, '');
let sessionId;
let screenshotDriver;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

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

async function findByAccessibilityId(label) {
  const value = await request(`/session/${sessionId}/element`, {
    using: 'accessibility id',
    value: label,
  });
  return value['element-6066-11e4-a52e-4f735466cecf'];
}

async function elementAttribute(elementId, name) {
  return request(`/session/${sessionId}/element/${elementId}/attribute/${name}`, undefined, 'GET');
}

async function tap(label) {
  const elementId = await findByAccessibilityId(label);
  await request(`/session/${sessionId}/element/${elementId}/click`, {});
}

async function waitForSelected(label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const elementId = await findByAccessibilityId(label);
      if (String(await elementAttribute(elementId, 'selected')) === 'true') return;
    } catch {
      // The destination may still be mounting.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for selected destination "${label}"`);
}

async function typeInto(label, value) {
  const elementId = await findByAccessibilityId(label);
  await request(`/session/${sessionId}/element/${elementId}/click`, {});
  await request(`/session/${sessionId}/element/${elementId}/value`, { text: value, value: [...value] });
}

async function expectMissing(label, timeout = 1_500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await findByAccessibilityId(label);
    } catch {
      return;
    }
    await sleep(150);
  }
  throw new Error(`Expected accessibility label "${label}" to be absent`);
}

async function waitFor(label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      return await findByAccessibilityId(label);
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Timed out waiting for accessibility label "${label}"`);
}

async function openProbe() {
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: deepLink',
    args: [{ url: 'brandthread://navigation-isolation-probe', package: bundleId }],
  });
  await waitFor('Buyer card');
}

async function openBuyerHome() {
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: deepLink',
    args: [{ url: 'brandthread://', package: bundleId }],
  });
  await waitFor('Home tab');
}

async function verifyBuyerSearchNavigation() {
  await openBuyerHome();

  const destinations = [
    ['buyer-tab-index', 'buyer-tab-index'],
    ['buyer-tab-discover', 'buyer-tab-discover'],
    ['buyer-tab-inbox', 'buyer-tab-inbox'],
    ['buyer-tab-profile', 'buyer-tab-profile'],
  ];
  for (const [control] of destinations) {
    await waitFor(control);
  }
  await waitFor('buyer-tab-search');

  for (const [control, selected] of destinations.slice(1)) {
    await tap(control);
    await waitForSelected(selected);
  }
  await tap('buyer-tab-index');
  await waitForSelected('buyer-tab-index');

  const standardPath = resolve(outputDir, 'buyer-search-standard.png');
  const transitionPath = resolve(outputDir, 'buyer-search-transition.png');
  const expandedPath = resolve(outputDir, 'buyer-search-expanded.png');
  await captureNativeScreenshot(standardPath);
  await tap('buyer-tab-search');
  await captureNativeScreenshot(transitionPath);
  await waitFor('Search Brandthread');
  await sleep(700);
  await captureNativeScreenshot(expandedPath);
  if (pixelHash(standardPath) === pixelHash(transitionPath) || pixelHash(transitionPath) === pixelHash(expandedPath)) {
    throw new Error('Buyer Search tab did not produce a visible animated transition');
  }

  for (const destination of ['Search Brandthread', 'Open search filters']) {
    await waitFor(destination);
  }

  await typeInto('Search Brandthread', 'linen');
  await waitFor('Search results for linen');
  await waitFor('Clear search');
  await tap('Clear search');
  await waitFor('Search is empty');

  await tap('Open search filters');
  await waitFor('Filter and sort');
  await tap('Close filters');

  await tap('buyer-search-home');
  await waitForSelected('buyer-tab-index');
  for (const [destination] of destinations) {
    await waitFor(destination);
  }
  await waitFor('buyer-tab-search');
  await expectMissing('Search Brandthread');
}

function captureNativeScreenshot(filePath) {
  if (screenshotDriver === 'ios') {
    execFileSync(
      'xcrun',
      ['simctl', 'io', process.env.IOS_SIMULATOR_UDID ?? 'booted', 'screenshot', '--type=png', filePath],
      { stdio: 'pipe' },
    );
    return;
  }
  if (screenshotDriver === 'android') {
    const args = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
    const png = execFileSync('adb', [...args, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
    });
    return writeFile(filePath, png);
  }
  throw new Error(`Unsupported native screenshot driver: ${screenshotDriver}`);
}

function pixelHash(filePath) {
  const output = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', filePath, '-f', 'framemd5', '-'],
    { encoding: 'utf8' },
  );
  const frame = output.split('\n').findLast((line) => line && !line.startsWith('#'));
  if (!frame) throw new Error(`Could not calculate a pixel hash for ${filePath}`);
  return frame.split(',').at(-1)?.trim();
}

async function captureCancelledGesture(flow, progress) {
  await tap(flow.control);
  await sleep(900);

  const { width, height } = await request(`/session/${sessionId}/window/rect`, undefined, 'GET');
  const start = flow.axis === 'x'
    ? { x: 2, y: Math.round(height / 2) }
    : { x: Math.round(width / 2), y: Math.round(height * 0.18) };
  const peak = flow.axis === 'x'
    ? { x: Math.round(width * progress), y: start.y }
    : { x: start.x, y: Math.round(start.y + height * 0.7 * progress) };
  const stem = `${flow.name}-${Math.round(progress * 100)}`;
  const settledPath = resolve(outputDir, `${stem}-settled.png`);
  const interruptedPath = resolve(outputDir, `${stem}.png`);
  await captureNativeScreenshot(settledPath);

  const actionRequest = request(`/session/${sessionId}/actions`, {
    actions: [{
      type: 'pointer',
      id: 'interrupted-back',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, ...start },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: 350, ...peak },
        { type: 'pause', duration: 1200 },
        { type: 'pointerMove', duration: 350, ...start },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });

  // Appium serializes commands within a session. Capture through simctl/adb
  // instead, while the independent Appium action is paused with pointer down.
  await sleep(700);
  await captureNativeScreenshot(interruptedPath);
  await actionRequest;
  await sleep(500);

  if (pixelHash(settledPath) === pixelHash(interruptedPath)) {
    throw new Error(`${flow.name} ${progress}: gesture did not visibly engage before capture`);
  }

  // A cancelled gesture must leave the destination mounted. If it returned to
  // the probe, its route controls become discoverable again.
  try {
    await findByAccessibilityId('Buyer card');
    throw new Error(`${flow.name} ${progress}: cancelled gesture exposed the origin screen`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('exposed the origin')) throw error;
  }

  await openProbe();
}

try {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const capabilities = process.env.APPIUM_CAPABILITIES
    ? JSON.parse(process.env.APPIUM_CAPABILITIES)
    : {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:bundleId': bundleId,
        'appium:noReset': true,
      };
  screenshotDriver = process.env.NATIVE_SCREENSHOT_DRIVER
    ?? (String(capabilities.platformName).toLowerCase() === 'android' ? 'android' : 'ios');
  const session = await request('/session', { capabilities: { alwaysMatch: capabilities } });
  sessionId = session.sessionId;
  await openProbe();

  for (const flow of flows) {
    for (const progress of progressPoints) {
      await captureCancelledGesture(flow, progress);
    }
  }

  await verifyBuyerSearchNavigation();

  console.log(`Captured and verified ${flows.length * progressPoints.length} interrupted native gesture frames and the buyer search navigation flow in ${outputDir}.`);
} finally {
  if (sessionId) {
    await request(`/session/${sessionId}`, undefined, 'DELETE').catch(() => {});
  }
}
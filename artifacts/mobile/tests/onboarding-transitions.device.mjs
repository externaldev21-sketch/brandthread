import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const endpoint = process.env.APPIUM_SERVER_URL;
const required = process.env.NATIVE_ONBOARDING_REQUIRED === '1';
const bundleId = process.env.NATIVE_APP_ID ?? 'com.brandthread.mobile';
const outputDir = resolve(process.env.NATIVE_ONBOARDING_RESULTS_DIR ?? 'test-results/onboarding-transitions');
const maxDestinationMs = Number(process.env.ONBOARDING_MAX_DESTINATION_MS ?? 250);
const maxSchedulingMs = Number(process.env.ONBOARDING_MAX_SCHEDULING_MS ?? 50);
const maxAnimationMs = Number(process.env.ONBOARDING_MAX_ANIMATION_MS ?? 340);
const maxSettleMs = Number(process.env.ONBOARDING_MAX_SETTLE_MS ?? 520);
const maxFrozenFrames = Number(process.env.ONBOARDING_MAX_FROZEN_FRAMES ?? 3);

if (!endpoint) {
  if (required) throw new Error('APPIUM_SERVER_URL is required by the native onboarding pipeline');
  console.log('Skipping native onboarding transitions: APPIUM_SERVER_URL is not configured.');
  process.exit(0);
}

const baseUrl = endpoint.replace(/\/$/, '');
let sessionId;
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

async function find(label) {
  const value = await request(`/session/${sessionId}/element`, { using: 'accessibility id', value: label });
  return value['element-6066-11e4-a52e-4f735466cecf'];
}

async function attribute(element, name) {
  return request(`/session/${sessionId}/element/${element}/attribute/${name}`, undefined, 'GET');
}

async function waitFor(label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { return await find(label); } catch { await sleep(20); }
  }
  throw new Error(`Timed out waiting for "${label}"`);
}

async function tap(label) {
  const element = await find(label);
  await request(`/session/${sessionId}/element/${element}/click`, {});
}

async function isKeyboardShown() {
  return request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: isKeyboardShown',
    args: [],
  });
}

async function open(flow, step) {
  const url = `brandthread://onboarding?deviceProbe=1&deviceFlow=${flow}&deviceStep=${step}`;
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: deepLink',
    args: [{ url, package: bundleId }],
  });
  await waitFor(`Onboarding ${flow} step ${step}`);
}

async function openAccountType() {
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: deepLink',
    args: [{ url: 'brandthread://onboarding?deviceProbe=1', package: bundleId }],
  });
  await waitFor('Onboarding choose step 0');
}

async function startRecording() {
  await request(`/session/${sessionId}/appium/start_recording_screen`, {
    options: { videoType: 'h264', videoQuality: 'medium', timeLimit: '10' },
  });
}

async function stopRecording(file) {
  const base64 = await request(`/session/${sessionId}/appium/stop_recording_screen`, {});
  await writeFile(file, Buffer.from(base64, 'base64'));
}

function assertMotion(file, name) {
  const hashes = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file, '-vf', 'fps=30,scale=160:-2', '-f', 'framemd5', '-',
  ], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1)?.trim());
  const changedIndices = [];
  for (let index = 1; index < hashes.length; index += 1) {
    if (hashes[index] !== hashes[index - 1]) changedIndices.push(index);
  }
  if (changedIndices.length < 3) {
    throw new Error(`${name}: recording did not contain a complete visible transition`);
  }
  const firstMotion = changedIndices[0];
  const lastMotion = changedIndices.at(-1);
  let longestFrozenRun = 0;
  let frozenRun = 0;
  for (let index = firstMotion + 1; index <= lastMotion; index += 1) {
    frozenRun = hashes[index] === hashes[index - 1] ? frozenRun + 1 : 0;
    longestFrozenRun = Math.max(longestFrozenRun, frozenRun);
  }
  if (longestFrozenRun > maxFrozenFrames) {
    throw new Error(`${name}: transition froze for ${longestFrozenRun} frames (limit ${maxFrozenFrames})`);
  }
}

function parseMetric(label) {
  return Object.fromEntries(label.split(';').slice(1).map((part) => {
    const [key, value] = part.split('=');
    return [key, Number(value)];
  }));
}

function assertTransitionMetric(label, name) {
  const metric = parseMetric(label);
  if (metric.firstFrame > maxSchedulingMs) {
    throw new Error(`${name}: animation scheduling took ${metric.firstFrame}ms (limit ${maxSchedulingMs}ms)`);
  }
  if (metric.animation > maxAnimationMs || metric.phases !== 1) {
    throw new Error(`${name}: transition serialized or settled late (${label})`);
  }
}

async function waitForMetric(testId, prefix, timeout = 2_000) {
  const element = await waitFor(testId);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const label = await attribute(element, 'label');
    if (String(label).startsWith(prefix)) return String(label);
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${testId} to report ${prefix}`);
}

async function measure({ name, flow, action, to, prepare }) {
  await prepare();
  const video = resolve(outputDir, `${name}.mp4`);
  await startRecording();
  await tap(action);
  await waitFor(`Onboarding ${flow} step ${to}`, maxDestinationMs + 1_000);
  const label = await waitForMetric('onboarding-transition-metric', `${flow}-${to};`);
  await sleep(maxSettleMs);
  await stopRecording(video);
  assertTransitionMetric(label, name);
  assertMotion(video, name);
  console.log(`${name}: ${label}; motion continuous`);
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
  const session = await request('/session', { capabilities: { alwaysMatch: capabilities } });
  sessionId = session.sessionId;

  for (const flow of ['buyer', 'seller']) {
    await measure({
      name: `${flow}-account-type-auth`,
      flow, action: 'Continue from account type', to: 1,
      prepare: async () => {
        await openAccountType();
        await tap(`${flow === 'buyer' ? 'Buyer' : 'Seller'} account type`);
      },
    });
    await measure({
      name: `${flow}-auth-name`,
      flow, action: 'Complete auth device probe', to: 2,
      prepare: () => open(flow, 1),
    });
    const focusLabel = await waitForMetric('onboarding-focus-metric', `${flow}-2;`);
    const focusMetric = parseMetric(focusLabel);
    if (focusMetric.delay < 245 || focusMetric.delay > 380 || focusMetric.focused !== 1) {
      throw new Error(`${flow}-auth-name: delayed focus outside budget (${focusLabel})`);
    }
    if (!await isKeyboardShown()) throw new Error(`${flow}-auth-name: input focused without opening the keyboard`);
    const loading = flow === 'buyer' ? 4 : 7;
    const notifications = flow === 'buyer' ? 5 : 8;
    const success = flow === 'buyer' ? 6 : 9;
    await open(flow, loading);
    const loadingStarted = performance.now();
    await waitFor(`Onboarding ${flow} step ${notifications}`, 10_000);
    const loadingMetric = await waitForMetric('onboarding-transition-metric', `${flow}-${notifications};`);
    assertTransitionMetric(loadingMetric, `${flow}-loading-notifications`);
    const loadingElapsed = performance.now() - loadingStarted;
    if (loadingElapsed > 7_000) throw new Error(`${flow}-loading-notifications took ${loadingElapsed.toFixed(0)}ms`);
    console.log(`${flow}-loading-notifications: ${loadingElapsed.toFixed(0)}ms; ${loadingMetric}`);
    await measure({
      name: `${flow}-notifications-success`,
      flow, action: 'Not now', to: success,
      prepare: () => open(flow, notifications),
    });
  }
} finally {
  if (sessionId) await request(`/session/${sessionId}`, undefined, 'DELETE').catch(() => {});
}
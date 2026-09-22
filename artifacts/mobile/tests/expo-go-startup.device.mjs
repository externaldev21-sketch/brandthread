import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { currentLogBytes, metroBundleStatus, startupFailure } from './expo-go-startup-core.mjs';

const endpoint = process.env.APPIUM_SERVER_URL;
const platform = (process.env.EXPO_GO_STARTUP_PLATFORM ?? '').toLowerCase();
const projectUrl = process.env.EXPO_GO_PROJECT_URL;
const required = process.env.EXPO_GO_STARTUP_REQUIRED === '1';
const timeoutMs = Number(process.env.EXPO_GO_STARTUP_TIMEOUT_MS ?? 45_000);
const outputDir = resolve(
  process.env.EXPO_GO_STARTUP_RESULTS_DIR ?? `test-results/expo-go-startup/${platform || 'unknown'}`,
);
const expoGoId = process.env.EXPO_GO_APP_ID
  ?? (platform === 'android' ? 'host.exp.exponent' : 'host.exp.Exponent');
const readyLabel = 'Brandthread startup ready';

if (!endpoint || !platform || !projectUrl || (required && !process.env.METRO_LOG_FILE)) {
  const missing = [
    !endpoint && 'APPIUM_SERVER_URL',
    !platform && 'EXPO_GO_STARTUP_PLATFORM',
    !projectUrl && 'EXPO_GO_PROJECT_URL',
    required && !process.env.METRO_LOG_FILE && 'METRO_LOG_FILE',
  ].filter(Boolean).join(', ');
  if (required) throw new Error(`Expo Go startup smoke test requires: ${missing}`);
  console.log(`Skipping Expo Go startup smoke test; missing: ${missing}`);
  process.exit(0);
}
if (!['ios', 'android'].includes(platform)) {
  throw new Error('EXPO_GO_STARTUP_PLATFORM must be "ios" or "android"');
}

const baseUrl = endpoint.replace(/\/$/, '');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
let sessionId;
let metroStartOffset = 0;

async function request(path, body, method = 'POST', allowFailure = false) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!allowFailure && (!response.ok || result.value?.error)) {
    throw new Error(`${method} ${path}: ${JSON.stringify(result.value ?? result)}`);
  }
  return result.value;
}

async function findReadyMarker() {
  const value = await request(`/session/${sessionId}/element`, {
    using: 'accessibility id',
    value: readyLabel,
  });
  return value['element-6066-11e4-a52e-4f735466cecf'];
}

async function collectAppiumLogs() {
  const logs = [];
  const types = await request(`/session/${sessionId}/log/types`, undefined, 'GET', true);
  for (const type of Array.isArray(types) ? types : []) {
    const entries = await request(`/session/${sessionId}/log`, { type }, 'POST', true);
    logs.push(`--- ${type} ---`, JSON.stringify(entries ?? [], null, 2));
  }
  return logs.join('\n');
}

function adbArgs() {
  return process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : [];
}

function clearAndroidLogs() {
  if (platform !== 'android') return;
  execFileSync('adb', [...adbArgs(), 'logcat', '-c'], { stdio: 'pipe' });
}

function collectAndroidLogs() {
  if (platform !== 'android') return '';
  try {
    const pid = execFileSync('adb', [...adbArgs(), 'shell', 'pidof', expoGoId], {
      encoding: 'utf8',
    }).trim().split(/\s+/)[0];
    if (!pid) return `Expo Go process ${expoGoId} is not running.`;
    return execFileSync('adb', [...adbArgs(), 'logcat', '--pid', pid, '-d', '-v', 'threadtime'], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    return `Unable to collect adb logcat: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function assertScreenshotIsNotBlank(file) {
  const pixels = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', 'scale=64:64,format=gray', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: 1024 * 1024 },
  );
  let minimum = 255;
  let maximum = 0;
  for (const value of pixels) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (maximum - minimum < 8) {
    throw new Error(`Initial ${platform} screen is blank (luma range ${minimum}-${maximum})`);
  }
}

async function currentMetroLogs() {
  const contents = await readFile(process.env.METRO_LOG_FILE);
  return currentLogBytes(contents, metroStartOffset);
}

async function captureArtifacts(error) {
  const metadata = {
    platform,
    projectUrl,
    expoGoId,
    capturedAt: new Date().toISOString(),
    error: error instanceof Error ? error.stack : error ? String(error) : null,
  };
  await writeFile(resolve(outputDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  if (!sessionId) return { screenshot: null, logs: '' };

  const source = await request(`/session/${sessionId}/source`, undefined, 'GET', true);
  await writeFile(resolve(outputDir, 'page-source.xml'), String(source ?? ''));
  const screenshot = await request(`/session/${sessionId}/screenshot`, undefined, 'GET', true);
  const screenshotPath = resolve(outputDir, 'initial-screen.png');
  if (typeof screenshot === 'string' && screenshot) {
    await writeFile(screenshotPath, Buffer.from(screenshot, 'base64'));
  }
  const appiumLogs = await collectAppiumLogs();
  const androidLogs = collectAndroidLogs();
  const logs = `${appiumLogs}\n${androidLogs}`;
  await writeFile(resolve(outputDir, 'device.log'), logs);
  await copyFile(process.env.METRO_LOG_FILE, resolve(outputDir, 'metro.log')).catch(async (copyError) => {
    await writeFile(
      resolve(outputDir, 'metro.log'),
      process.env.METRO_LOG_FILE
        ? `Unable to copy ${process.env.METRO_LOG_FILE}: ${copyError instanceof Error ? copyError.message : String(copyError)}`
        : 'METRO_LOG_FILE was not configured for this optional run.',
    );
  });
  return {
    screenshot: typeof screenshot === 'string' && screenshot ? screenshotPath : null,
    logs,
    currentDeviceLogs: platform === 'android' ? androidLogs : appiumLogs,
    currentMetroLogs: await currentMetroLogs().catch(() => ''),
  };
}

let failure;
try {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  metroStartOffset = (await stat(process.env.METRO_LOG_FILE)).size;
  clearAndroidLogs();
  const platformCapabilities = platform === 'ios'
    ? process.env.APPIUM_IOS_CAPABILITIES
    : process.env.APPIUM_ANDROID_CAPABILITIES;
  const capabilities = platformCapabilities || process.env.APPIUM_CAPABILITIES
    ? JSON.parse(platformCapabilities ?? process.env.APPIUM_CAPABILITIES)
    : platform === 'android'
      ? {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:appPackage': expoGoId,
          'appium:noReset': true,
          'appium:autoLaunch': false,
        }
      : {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:bundleId': expoGoId,
          'appium:noReset': true,
          'appium:autoLaunch': false,
        };
  if (String(capabilities.platformName).toLowerCase() !== platform) {
    throw new Error(`The ${platform} startup check received ${capabilities.platformName} capabilities`);
  }

  const session = await request('/session', { capabilities: { alwaysMatch: capabilities } });
  sessionId = session.sessionId;
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: terminateApp',
    args: [{ appId: expoGoId }],
  }, 'POST', true);
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: activateApp',
    args: [{ appId: expoGoId }],
  });
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: deepLink',
    args: [{ url: projectUrl, package: expoGoId }],
  });

  const deadline = Date.now() + timeoutMs;
  let rootRendered = false;
  let freshBundleServed = false;
  while (Date.now() < deadline && (!rootRendered || !freshBundleServed)) {
    try {
      if (!rootRendered) {
        await findReadyMarker();
        rootRendered = true;
      }
    } catch {
      // The app may still be downloading/evaluating the current bundle.
    }
    const metroStatus = metroBundleStatus(await currentMetroLogs(), platform);
    if (metroStatus.failure) throw new Error(`Metro reported startup failure ${metroStatus.failure}`);
    freshBundleServed = metroStatus.ready;
    if (!rootRendered || !freshBundleServed) await sleep(300);
  }
  if (!rootRendered) {
    throw new Error(`Timed out after ${timeoutMs}ms waiting for the Brandthread root route to render`);
  }
  if (!freshBundleServed) {
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for Metro to serve a fresh ${platform} bundle for this launch`,
    );
  }
} catch (error) {
  failure = error;
} finally {
  const artifacts = await captureArtifacts(failure);
  if (!failure && artifacts.screenshot) {
    try {
      assertScreenshotIsNotBlank(artifacts.screenshot);
      const matchedPattern = startupFailure(
        `${artifacts.currentMetroLogs}\n${artifacts.currentDeviceLogs}`,
      );
      if (matchedPattern) throw new Error(`Device logs contain startup failure pattern ${matchedPattern}`);
    } catch (error) {
      failure = error;
      await captureArtifacts(failure);
    }
  } else if (!failure) {
    failure = new Error('Appium did not return an initial-screen screenshot');
    await captureArtifacts(failure);
  }
  if (sessionId) await request(`/session/${sessionId}`, undefined, 'DELETE', true);
}

if (failure) {
  throw new Error(
    `${failure instanceof Error ? failure.message : String(failure)}. ` +
    `Startup diagnostics were saved to ${outputDir}`,
    { cause: failure },
  );
}
console.log(`Verified a clean ${platform} Expo Go launch; diagnostics saved to ${outputDir}.`);
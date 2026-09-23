import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const endpoint = process.env.APPIUM_SERVER_URL;
const platform = (process.env.NATIVE_BUYER_ADDRESSES_PLATFORM ?? '').toLowerCase();
const required = process.env.NATIVE_BUYER_ADDRESSES_REQUIRED === '1';
const bundleId = process.env.NATIVE_APP_ID ?? 'com.brandthread.mobile';
const labels = (process.env.NATIVE_BUYER_ADDRESS_LABELS ?? 'Home,Office')
  .split(',')
  .map((label) => label.trim())
  .filter(Boolean);
const expectRetry = process.env.NATIVE_BUYER_ADDRESSES_EXPECT_RETRY === '1';
const outputDir = resolve(
  process.env.NATIVE_BUYER_ADDRESSES_RESULTS_DIR
    ?? `test-results/buyer-addresses-accessibility/${platform || 'unknown'}`,
);

if (!endpoint || !platform) {
  const missing = [!endpoint && 'APPIUM_SERVER_URL', !platform && 'NATIVE_BUYER_ADDRESSES_PLATFORM']
    .filter(Boolean)
    .join(', ');
  if (required) throw new Error(`Native shipping-address accessibility check requires: ${missing}`);
  console.log(`Skipping native shipping-address accessibility check; missing: ${missing}`);
  process.exit(0);
}
if (!['ios', 'android'].includes(platform)) {
  throw new Error('NATIVE_BUYER_ADDRESSES_PLATFORM must be "ios" or "android"');
}
if (!expectRetry && labels.length < 2) {
  throw new Error('NATIVE_BUYER_ADDRESS_LABELS must name at least two seeded addresses');
}

const baseUrl = endpoint.replace(/\/$/, '');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
let sessionId;

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

async function find(label) {
  const value = await request(`/session/${sessionId}/element`, {
    using: 'accessibility id',
    value: label,
  });
  return value['element-6066-11e4-a52e-4f735466cecf'];
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

async function attribute(element, name) {
  return request(`/session/${sessionId}/element/${element}/attribute/${name}`, undefined, 'GET');
}

async function checkedState(label) {
  const element = await waitFor(label);
  const attributeName = platform === 'ios' ? 'value' : 'checked';
  const value = String(await attribute(element, attributeName)).toLowerCase();
  return {
    element,
    checked: ['true', '1', 'checked', 'selected'].includes(value),
    raw: value,
    attributeName,
  };
}

async function source() {
  return String(await request(`/session/${sessionId}/source`, undefined, 'GET'));
}

function assertSourceOrder(xml, orderedLabels) {
  let previous = -1;
  for (const label of orderedLabels) {
    const index = xml.indexOf(label);
    if (index < 0) throw new Error(`Accessibility tree did not contain "${label}"`);
    if (index <= previous) {
      throw new Error(`Accessibility focus order is incorrect near "${label}"`);
    }
    previous = index;
  }
}

async function assertButton(label) {
  const element = await waitFor(label);
  const role = String(await attribute(element, platform === 'ios' ? 'type' : 'class'));
  const expected = platform === 'ios' ? 'Button' : 'Button';
  if (!role.includes(expected)) throw new Error(`${label} exposed unexpected native role ${role}`);
}

async function openAddresses() {
  await request(`/session/${sessionId}/execute/sync`, {
    script: 'mobile: deepLink',
    args: [{ url: 'brandthread://buyer-addresses', package: bundleId }],
  });
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

try {
  const platformCapabilities = platform === 'ios'
    ? process.env.APPIUM_IOS_CAPABILITIES
    : process.env.APPIUM_ANDROID_CAPABILITIES;
  const capabilities = platformCapabilities || process.env.APPIUM_CAPABILITIES
    ? JSON.parse(platformCapabilities ?? process.env.APPIUM_CAPABILITIES)
    : platform === 'android'
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
  if (String(capabilities.platformName).toLowerCase() !== platform) {
    throw new Error(`The ${platform} address check received ${capabilities.platformName} capabilities`);
  }

  const session = await request('/session', { capabilities: { alwaysMatch: capabilities } });
  sessionId = session.sessionId;
  await openAddresses();

  if (expectRetry) {
    await assertButton('Go back');
    await assertButton('Retry loading saved addresses');
    await tap('Retry loading saved addresses');
    await writeFile(resolve(outputDir, 'retry-page-source.xml'), await source());
    console.log(`Verified ${platform} back and retry actions in the native accessibility tree.`);
  } else {
    const [first, second] = labels;
    const orderedActions = labels.flatMap((label) => [
      `Edit ${label} address`,
      `Delete ${label} address`,
    ]);
    const initialSource = await source();
    assertSourceOrder(initialSource, ['Go back', ...orderedActions]);
    await writeFile(resolve(outputDir, 'address-list-page-source.xml'), initialSource);

    await assertButton('Go back');
    for (const action of orderedActions) await assertButton(action);
    await assertButton(`Set ${second} as default address`);

    await tap(`Delete ${first} address`);
    await waitFor('Delete Address');
    await tap('Cancel');

    await tap(`Edit ${second} address`);
    await assertButton('Close address form');
    const before = await checkedState('Set as default address');
    if (before.checked) {
      throw new Error(`Default checkbox began checked (${before.attributeName}=${before.raw})`);
    }
    await request(`/session/${sessionId}/element/${before.element}/click`, {});
    const after = await checkedState('Set as default address');
    if (!after.checked) {
      throw new Error(
        `Default checkbox did not announce checked state (${after.attributeName}=${after.raw})`,
      );
    }
    await tap('Close address form');

    await tap(`Set ${second} as default address`);
    await waitFor(`Set ${first} as default address`);
    await tap(`Set ${first} as default address`);
    await waitFor(`Set ${second} as default address`);
    await writeFile(resolve(outputDir, 'completed-page-source.xml'), await source());
    console.log(
      `Verified ${platform} address focus order, edit, delete dialog, close, set-default, and checkbox state.`,
    );
  }
} finally {
  if (sessionId) await request(`/session/${sessionId}`, undefined, 'DELETE', true);
}
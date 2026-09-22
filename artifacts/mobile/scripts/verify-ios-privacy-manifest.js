#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const appConfigPath = path.join(projectRoot, 'app.json');
const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
const configuredManifest = appConfig?.expo?.ios?.privacyManifests;

const REQUIRED_API_DECLARATIONS = {
  NSPrivacyAccessedAPICategoryFileTimestamp: 'C617.1',
  NSPrivacyAccessedAPICategorySystemBootTime: '35F9.1',
  NSPrivacyAccessedAPICategoryDiskSpace: 'E174.1',
  NSPrivacyAccessedAPICategoryUserDefaults: 'CA92.1',
};

// Must match docs/app-store/privacy-labels.md exactly, so the App Store
// privacy questionnaire, the privacy manifest and the code never drift apart.
const REQUIRED_COLLECTED_TYPES = [
  'NSPrivacyCollectedDataTypeName',
  'NSPrivacyCollectedDataTypeEmailAddress',
  'NSPrivacyCollectedDataTypePhoneNumber',
  'NSPrivacyCollectedDataTypePhysicalAddress',
  'NSPrivacyCollectedDataTypeUserID',
  'NSPrivacyCollectedDataTypeDeviceID',
  'NSPrivacyCollectedDataTypePaymentInfo',
  'NSPrivacyCollectedDataTypeOtherFinancialInfo',
  'NSPrivacyCollectedDataTypePurchaseHistory',
  'NSPrivacyCollectedDataTypePhotosorVideos',
  'NSPrivacyCollectedDataTypeAudioData',
  'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
  'NSPrivacyCollectedDataTypeOtherUserContent',
  'NSPrivacyCollectedDataTypeCustomerSupport',
  'NSPrivacyCollectedDataTypeProductInteraction',
  'NSPrivacyCollectedDataTypeOtherDiagnosticData',
];

// No feature collects these. Sensitive Info covers Apple's special categories
// (e.g. biometric data); Face ID stays on device and Stripe Identity runs in
// the external browser, so Brandthread never receives that data.
const FORBIDDEN_COLLECTED_TYPES = [
  'NSPrivacyCollectedDataTypeSensitiveInfo',
  'NSPrivacyCollectedDataTypePreciseLocation',
  'NSPrivacyCollectedDataTypeCoarseLocation',
];

function fail(message) {
  console.error(`Privacy manifest verification failed: ${message}`);
  process.exit(1);
}

function assertConfiguredManifest() {
  if (!configuredManifest) fail('expo.ios.privacyManifests is missing from app.json');
  if (configuredManifest.NSPrivacyTracking !== false) {
    fail('NSPrivacyTracking must remain false unless Brandthread adds cross-app tracking');
  }

  for (const [category, reason] of Object.entries(REQUIRED_API_DECLARATIONS)) {
    const declaration = configuredManifest.NSPrivacyAccessedAPITypes?.find(
      (entry) => entry.NSPrivacyAccessedAPIType === category,
    );
    if (!declaration?.NSPrivacyAccessedAPITypeReasons?.includes(reason)) {
      fail(`${category} is missing required reason ${reason}`);
    }
  }

  const declaredTypes = (configuredManifest.NSPrivacyCollectedDataTypes ?? []).map(
    (entry) => entry.NSPrivacyCollectedDataType,
  );
  for (const dataType of FORBIDDEN_COLLECTED_TYPES) {
    if (declaredTypes.includes(dataType)) {
      fail(`${dataType} is declared, but no Brandthread feature collects it`);
    }
  }
  const unexpected = declaredTypes.filter((dataType) => !REQUIRED_COLLECTED_TYPES.includes(dataType));
  if (unexpected.length > 0) {
    fail(`${unexpected.join(', ')} must also be added to this verifier and docs/app-store/privacy-labels.md`);
  }

  for (const dataType of REQUIRED_COLLECTED_TYPES) {
    const declaration = configuredManifest.NSPrivacyCollectedDataTypes?.find(
      (entry) => entry.NSPrivacyCollectedDataType === dataType,
    );
    if (!declaration) fail(`${dataType} is missing`);
    if (declaration.NSPrivacyCollectedDataTypeTracking !== false) {
      fail(`${dataType} must not be marked as tracking`);
    }
  }
}

function findGeneratedManifests(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findGeneratedManifests(fullPath);
    return entry.name === 'PrivacyInfo.xcprivacy' ? [fullPath] : [];
  });
}

function assertGeneratedManifest() {
  const manifests = findGeneratedManifests(path.join(projectRoot, 'ios'));
  if (manifests.length === 0) {
    fail('no generated ios/**/PrivacyInfo.xcprivacy found; run Expo prebuild before this verifier');
  }
  const appManifestPath = manifests.find(
    (manifestPath) => !manifestPath.includes(`${path.sep}Pods${path.sep}`)
      && !manifestPath.includes(`${path.sep}build${path.sep}`),
  );
  if (!appManifestPath) fail('the app target PrivacyInfo.xcprivacy was not generated');

  const generated = fs.readFileSync(appManifestPath, 'utf8');
  if (!/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(generated)) {
    fail('generated app manifest does not explicitly declare tracking false');
  }

  const dictionaries = generated.match(/<dict>[\s\S]*?<\/dict>/g) ?? [];
  for (const [category, reason] of Object.entries(REQUIRED_API_DECLARATIONS)) {
    const entry = dictionaries.find((dictionary) =>
      dictionary.includes(`<string>${category}</string>`),
    );
    if (!entry) fail(`generated app manifest is missing ${category}`);
    if (!entry.includes(`<string>${reason}</string>`)) {
      fail(`generated ${category} declaration is missing paired reason ${reason}`);
    }
  }

  for (const dataType of FORBIDDEN_COLLECTED_TYPES) {
    if (generated.includes(`<string>${dataType}</string>`)) {
      fail(`generated app manifest declares ${dataType}, but no Brandthread feature collects it`);
    }
  }

  for (const dataType of REQUIRED_COLLECTED_TYPES) {
    const entry = dictionaries.find((dictionary) =>
      dictionary.includes(`<string>${dataType}</string>`),
    );
    if (!entry) fail(`generated app manifest is missing ${dataType}`);
    if (!/<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/.test(entry)) {
      fail(`generated ${dataType} declaration must be linked to the user`);
    }
    if (!/<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/.test(entry)) {
      fail(`generated ${dataType} declaration must set tracking false`);
    }
    if (!entry.includes('<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>')) {
      fail(`generated ${dataType} declaration is missing its app-functionality purpose`);
    }
  }
  console.log(`Verified generated app privacy manifest: ${path.relative(projectRoot, appManifestPath)}`);
}

module.exports = { REQUIRED_COLLECTED_TYPES, FORBIDDEN_COLLECTED_TYPES };

if (require.main === module) {
  assertConfiguredManifest();

  if (process.argv.includes('--config-only')) {
    console.log('Verified Expo privacy-manifest configuration.');
  } else {
    assertGeneratedManifest();
  }
}

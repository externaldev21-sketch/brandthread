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
  'NSPrivacyCollectedDataTypeContacts',
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
  // Signed-in searches are stored with the account for "Recent searches"
  // (search_log, routes/public.ts) and erased with the account.
  'NSPrivacyCollectedDataTypeSearchHistory',
  'NSPrivacyCollectedDataTypeOtherDiagnosticData',
  'NSPrivacyCollectedDataTypeCrashData',
  'NSPrivacyCollectedDataTypePerformanceData',
];

// No feature collects these. Sensitive Info covers Apple's special categories
// (e.g. biometric data); Face ID stays on device and Stripe Identity runs in
// the external browser, so Brandthread never receives that data.
const FORBIDDEN_COLLECTED_TYPES = [
  'NSPrivacyCollectedDataTypeSensitiveInfo',
  'NSPrivacyCollectedDataTypePreciseLocation',
  'NSPrivacyCollectedDataTypeCoarseLocation',
];

// Native modules that force an Info.plist usage string (or an ATT prompt) if
// they are ever added. Keys are npm package names from package.json; values
// list the plugin option or Info.plist key that must then be configured. A
// package that is NOT installed needs nothing, and its key must stay absent
// so the App Store does not see a permission the app never uses.
const PURPOSE_STRING_REQUIREMENTS = {
  'expo-camera': [['expo-camera', 'cameraPermission'], ['expo-camera', 'microphonePermission']],
  'expo-image-picker': [['expo-image-picker', 'photosPermission'], ['expo-image-picker', 'cameraPermission'], ['expo-image-picker', 'microphonePermission']],
  'expo-media-library': [['expo-media-library', 'photosPermission'], ['expo-media-library', 'savePhotosPermission']],
  'expo-audio': [['expo-audio', 'microphonePermission']],
  'expo-local-authentication': [['expo-local-authentication', 'faceIDPermission']],
  // Agora (live video + calls) uses the camera and microphone directly.
  'react-native-agora': [['expo-camera', 'cameraPermission'], ['expo-camera', 'microphonePermission']],
  'expo-contacts': [['expo-contacts', 'contactsPermission']],
  'expo-location': [['expo-location', 'locationWhenInUsePermission']],
  'expo-tracking-transparency': [['expo-tracking-transparency', 'userTrackingPermission']],
};

// Info.plist keys that must NOT be present: there is no in-app SDK that
// tracks across apps (the Meta/TikTok pixels run on the website only), and no
// feature reads contacts, location, Bluetooth devices or speech.
const FORBIDDEN_INFO_PLIST_KEYS = [
  'NSUserTrackingUsageDescription',
  'NSContactsUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSLocationAlwaysUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSSpeechRecognitionUsageDescription',
];

const FORBIDDEN_ANDROID_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
];

// Must be blocked so a transitive SDK manifest can never add them and
// contradict the Play Data safety form (docs/review-readiness/play-data-safety.md).
const REQUIRED_BLOCKED_ANDROID_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_PHONE_STATE',
];

function pluginEntries(expoConfig, name) {
  return (expoConfig.plugins ?? []).filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === name);
}

/** Returns a list of problems with the native permission / encryption / Android config. */
function getNativeConfigErrors(expoConfig, packageJson) {
  const errors = [];
  const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  const infoPlist = expoConfig.ios?.infoPlist ?? {};

  for (const [pkg, options] of Object.entries(PURPOSE_STRING_REQUIREMENTS)) {
    if (!deps[pkg]) {
      if (pluginEntries(expoConfig, pkg).length > 0) errors.push(`${pkg} is configured as a plugin but is not a dependency`);
      continue;
    }
    for (const [plugin, option] of options) {
      const entries = pluginEntries(expoConfig, plugin);
      const values = entries.map((entry) => (Array.isArray(entry) ? entry[1]?.[option] : undefined));
      if (entries.length === 0 || values.some((value) => typeof value !== 'string' || value.trim().length < 30)) {
        errors.push(`${pkg} needs an explicit, specific "${option}" purpose string on the ${plugin} plugin`);
      }
    }
  }

  // A plugin listed twice runs twice; the later purpose string silently wins.
  for (const plugin of ['expo-local-authentication', 'expo-camera', 'expo-audio', 'expo-media-library', 'expo-image-picker']) {
    if (pluginEntries(expoConfig, plugin).length > 1) errors.push(`${plugin} is listed more than once in plugins`);
  }

  for (const key of FORBIDDEN_INFO_PLIST_KEYS) {
    if (key in infoPlist) errors.push(`ios.infoPlist.${key} is set but no feature needs it`);
  }

  if (expoConfig.ios?.config?.usesNonExemptEncryption !== false) {
    errors.push('ios.config.usesNonExemptEncryption must be false (writes ITSAppUsesNonExemptEncryption=false)');
  }

  const permissions = expoConfig.android?.permissions ?? [];
  for (const permission of FORBIDDEN_ANDROID_PERMISSIONS) {
    if (permissions.includes(permission)) errors.push(`android.permissions must not list ${permission}`);
  }
  const blocked = expoConfig.android?.blockedPermissions ?? [];
  for (const permission of REQUIRED_BLOCKED_ANDROID_PERMISSIONS) {
    if (!blocked.includes(permission)) errors.push(`android.blockedPermissions must include ${permission}`);
  }
  return errors;
}

function fail(message) {
  console.error(`Privacy manifest verification failed: ${message}`);
  process.exit(1);
}

function assertConfiguredManifest() {
  const nativeErrors = getNativeConfigErrors(
    appConfig.expo,
    JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')),
  );
  if (nativeErrors.length > 0) fail(nativeErrors.join('; '));
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

module.exports = {
  REQUIRED_COLLECTED_TYPES,
  FORBIDDEN_COLLECTED_TYPES,
  getNativeConfigErrors,
};

if (require.main === module) {
  assertConfiguredManifest();

  if (process.argv.includes('--config-only')) {
    console.log('Verified Expo privacy-manifest configuration.');
  } else {
    assertGeneratedManifest();
  }
}

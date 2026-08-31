#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const appConfigPath = path.join(projectRoot, "app.json");
const expected = {
  bundleIdentifier: "com.brandthread.mobile",
  scheme: "brandthread",
  appleStrategy: "oauth_apple",
  entitlement: "com.apple.developer.applesignin",
};

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read or parse ${path.basename(filePath)} (${reason})`);
  }
}

function getAppleAuthErrors(expoConfig) {
  const errors = [];
  if (expoConfig?.scheme !== expected.scheme) {
    errors.push(`Expo scheme must remain "${expected.scheme}"`);
  }
  if (expoConfig?.ios?.bundleIdentifier !== expected.bundleIdentifier) {
    errors.push(`iOS bundleIdentifier must remain "${expected.bundleIdentifier}"`);
  }
  if (expoConfig?.ios?.usesAppleSignIn !== true) {
    errors.push("ios.usesAppleSignIn must be true");
  }
  const entitlement = expoConfig?.ios?.entitlements?.[expected.entitlement];
  if (!Array.isArray(entitlement) || !entitlement.includes("Default")) {
    errors.push(`ios.entitlements.${expected.entitlement} must include "Default"`);
  }
  if (!Array.isArray(expoConfig?.plugins) || !expoConfig.plugins.includes("expo-apple-authentication")) {
    errors.push('plugins must include "expo-apple-authentication"');
  }
  return errors;
}

function verifyAppleAuth() {
  const appConfig = readJson(appConfigPath);
  const errors = getAppleAuthErrors(appConfig?.expo);
  if (errors.length > 0) {
    console.error([
      "Apple sign-in configuration verification failed:",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"));
    process.exitCode = 1;
    return false;
  }
  console.log(
    `Verified Apple sign-in capability for ${expected.bundleIdentifier} using the ${expected.scheme} URL scheme.`,
  );
  return true;
}

module.exports = {
  expected,
  getAppleAuthErrors,
  verifyAppleAuth,
};

if (require.main === module) verifyAppleAuth();
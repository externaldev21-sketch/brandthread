#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const configPath = path.join(projectRoot, "eas.json");
const PLACEHOLDER_PREFIX = "REPLACE_WITH_";

// Same formats `eas submit` enforces, checked up front so a mistake is caught
// before a build is uploaded.
const IOS_FIELDS = [
  ["appleId", /^\S+@\S+\.\S+$/, "the Apple ID email used to sign in to App Store Connect"],
  ["ascAppId", /^\d{1,30}$/, "the numeric Apple ID shown in App Store Connect > App Information"],
  ["appleTeamId", /^[A-Z0-9]{10}$/, "the 10-character Team ID from developer.apple.com > Membership"],
];

function getSubmitConfigErrors(config) {
  const errors = [];
  const ios = config?.submit?.production?.ios;
  for (const [field, format, description] of IOS_FIELDS) {
    const value = ios?.[field];
    if (typeof value !== "string" || value.startsWith(PLACEHOLDER_PREFIX)) {
      errors.push(`submit.production.ios.${field} is still a placeholder; set it to ${description}`);
    } else if (!format.test(value)) {
      errors.push(`submit.production.ios.${field} "${value}" is not valid; it must be ${description}`);
    }
  }
  const android = config?.submit?.production?.android;
  if (!android?.track) errors.push("submit.production.android.track is missing");
  return errors;
}

function verifySubmitConfig() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const errors = getSubmitConfigErrors(config);
  if (errors.length > 0) {
    console.error([
      "Store submission configuration is not ready:",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"));
    process.exitCode = 1;
    return false;
  }
  console.log("Verified eas.json submit.production is ready for eas submit.");
  return true;
}

module.exports = { PLACEHOLDER_PREFIX, getSubmitConfigErrors, verifySubmitConfig };

if (require.main === module) verifySubmitConfig();

#!/usr/bin/env node
/**
 * Checks that `eas submit -p ios --profile production` has the three Apple
 * values it needs. eas.json cannot read environment variables, so they are not
 * committed there; `pnpm run submit:ios` (scripts/eas-submit.js) reads them
 * from the environment and hands them to eas submit:
 *
 *   EXPO_APPLE_ID       Apple ID email used to sign in to App Store Connect
 *                       (eas-cli's own variable; EAS_APPLE_ID also accepted)
 *   EAS_ASC_APP_ID      App Store Connect → your app → App Information →
 *                       General Information → Apple ID (a number like 6471234567)
 *   EXPO_APPLE_TEAM_ID  developer.apple.com → Account → Membership details →
 *                       Team ID (10 characters; eas-cli's own variable;
 *                       EAS_APPLE_TEAM_ID also accepted)
 *
 * A value committed in eas.json submit.production.ios still works and is
 * overridden by the environment.
 */
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const configPath = path.join(projectRoot, "eas.json");
const PLACEHOLDER_PREFIX = "REPLACE_WITH_";

// Same formats `eas submit` enforces, checked up front so a mistake is caught
// before a build is uploaded. `env` lists accepted variable names, preferred first.
const IOS_FIELDS = [
  {
    field: "appleId",
    env: ["EXPO_APPLE_ID", "EAS_APPLE_ID"],
    format: /^\S+@\S+\.\S+$/,
    description: "the Apple ID email used to sign in to App Store Connect",
  },
  {
    field: "ascAppId",
    env: ["EAS_ASC_APP_ID"],
    format: /^\d{1,30}$/,
    description: "the numeric Apple ID shown in App Store Connect > your app > App Information",
  },
  {
    field: "appleTeamId",
    env: ["EXPO_APPLE_TEAM_ID", "EAS_APPLE_TEAM_ID"],
    format: /^[A-Z0-9]{10}$/,
    description: "the 10-character Team ID from developer.apple.com > Account > Membership details",
  },
];

function usable(value) {
  return typeof value === "string" && value.trim() !== "" && !value.startsWith(PLACEHOLDER_PREFIX);
}

/**
 * Resolves the iOS submit values: environment first, then eas.json.
 * Returns { values, errors }.
 */
function resolveIosSubmitValues(config, env = process.env) {
  const ios = config?.submit?.production?.ios ?? {};
  const values = {};
  const errors = [];
  for (const { field, env: names, format, description } of IOS_FIELDS) {
    const fromEnv = names.map((name) => env[name]).find(usable);
    const value = (fromEnv ?? (usable(ios[field]) ? ios[field] : undefined))?.trim();
    if (!value) {
      errors.push(`${names[0]} is not set; set it to ${description}`);
    } else if (!format.test(value)) {
      errors.push(`${names[0]} "${value}" is not valid; it must be ${description}`);
    } else {
      values[field] = value;
    }
  }
  return { values, errors };
}

function getSubmitConfigErrors(config, env = process.env) {
  const errors = [];
  const ios = config?.submit?.production?.ios ?? {};
  for (const { field } of IOS_FIELDS) {
    if (typeof ios[field] === "string" && ios[field].startsWith(PLACEHOLDER_PREFIX)) {
      errors.push(`eas.json submit.production.ios.${field} is a placeholder; remove it and use the environment variable instead`);
    }
  }
  errors.push(...resolveIosSubmitValues(config, env).errors);
  const android = config?.submit?.production?.android;
  if (!android?.track) errors.push("submit.production.android.track is missing");
  return errors;
}

function verifySubmitConfig(env = process.env) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const errors = getSubmitConfigErrors(config, env);
  if (errors.length > 0) {
    console.error([
      "Store submission configuration is not ready:",
      ...errors.map((error) => `- ${error}`),
      "See docs/app-store/release-flow.md (App Store Connect values).",
    ].join("\n"));
    process.exitCode = 1;
    return false;
  }
  console.log("Verified the App Store submit values (Apple ID, App Store Connect app ID, Team ID).");
  return true;
}

module.exports = { IOS_FIELDS, PLACEHOLDER_PREFIX, getSubmitConfigErrors, resolveIosSubmitValues, verifySubmitConfig };

if (require.main === module) verifySubmitConfig();

#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const configPath = path.join(projectRoot, "eas.json");
const REQUIRED_PROFILES = ["development", "preview", "production"];
const REQUIRED_IMAGE = "macos-sequoia-15.6-xcode-26.0";

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read or parse eas.json (${reason})`);
  }
}

function getIosBuildConfigErrors(config) {
  const errors = [];
  const profiles = config?.build ?? {};
  for (const profile of REQUIRED_PROFILES) {
    const image = profiles[profile]?.ios?.image;
    if (image !== REQUIRED_IMAGE) {
      errors.push(
        `${profile}.ios.image must be "${REQUIRED_IMAGE}" so the build uses Xcode 26.0 and the iOS 26 SDK`,
      );
    }
  }
  return errors;
}

function verifyIosBuild() {
  const errors = getIosBuildConfigErrors(readConfig());
  if (errors.length > 0) {
    console.error([
      "iOS build configuration verification failed:",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"));
    process.exitCode = 1;
    return false;
  }
  console.log(
    `Verified development, preview, and production iOS profiles use ${REQUIRED_IMAGE}.`,
  );
  return true;
}

module.exports = {
  REQUIRED_IMAGE,
  REQUIRED_PROFILES,
  getIosBuildConfigErrors,
  verifyIosBuild,
};

if (require.main === module) verifyIosBuild();
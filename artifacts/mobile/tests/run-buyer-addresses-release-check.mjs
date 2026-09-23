import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  armBuyerAddressFailure,
  cleanupBuyerAddressFixture,
  prepareBuyerAddressFixture,
} from "./buyer-addresses-release-fixture.mjs";

const platform = (
  process.env.NATIVE_BUYER_ADDRESSES_PLATFORM ?? ""
).toLowerCase();
const resultsRoot = resolve(
  process.env.NATIVE_BUYER_ADDRESSES_RESULTS_ROOT ??
    `test-results/buyer-addresses-accessibility/${platform || "unknown"}`,
);

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`Mobile release accessibility check requires ${name}`);
  return value;
}

function run(command, extraEnvironment = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn("/bin/sh", ["-eu", "-c", command], {
      env: { ...process.env, ...extraEnvironment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Command failed (${signal ?? code}): ${command}`));
    });
  });
}

if (!["ios", "android"].includes(platform)) {
  throw new Error('NATIVE_BUYER_ADDRESSES_PLATFORM must be "ios" or "android"');
}

requireEnvironment("APPIUM_SERVER_URL");
requireEnvironment("NATIVE_BUYER_ADDRESSES_DISPOSABLE_ACCOUNT");
const labels = requireEnvironment("NATIVE_BUYER_ADDRESS_LABELS")
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean);
if (labels.length !== 2) {
  throw new Error("Release checks require exactly two seeded address labels");
}

requireEnvironment("NATIVE_BUYER_ADDRESSES_API_BASE_URL");
requireEnvironment("NATIVE_BUYER_ADDRESSES_CONTROL_TOKEN");
requireEnvironment("NATIVE_BUYER_ADDRESSES_CLERK_SECRET_KEY");
const checkCommand = "node tests/buyer-addresses.device.mjs";

await mkdir(resultsRoot, { recursive: true });

let failure;
let account;
try {
  account = await prepareBuyerAddressFixture();
  await run(checkCommand, {
    NATIVE_BUYER_ADDRESSES_REQUIRED: "1",
    NATIVE_BUYER_ADDRESSES_EXPECT_RETRY: "0",
    NATIVE_BUYER_ADDRESSES_RESULTS_DIR: resolve(resultsRoot, "normal"),
  });
  await armBuyerAddressFailure(account);
  await run(checkCommand, {
    NATIVE_BUYER_ADDRESSES_REQUIRED: "1",
    NATIVE_BUYER_ADDRESSES_EXPECT_RETRY: "1",
    NATIVE_BUYER_ADDRESSES_RESULTS_DIR: resolve(resultsRoot, "retry"),
  });
} catch (error) {
  account ??= error?.fixtureAccount;
  failure = error;
} finally {
  try {
    await cleanupBuyerAddressFixture(account);
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError(
          [failure, cleanupError],
          "Accessibility check and cleanup failed",
        )
      : cleanupError;
  }
}

if (failure) throw failure;

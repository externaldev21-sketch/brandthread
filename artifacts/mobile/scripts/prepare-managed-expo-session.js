const { spawnSync } = require("node:child_process");

const sessionSecret = process.env.REPLIT_EXPO_SESSION_SECRET;
const warning =
  "Warning: Managed Expo sign-in could not be verified after 2 attempts. Phone preview may show an account mismatch; restart the Expo workflow to retry.";

if (!sessionSecret) {
  process.exit(0);
}

function run(args) {
  return spawnSync("pnpm", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024,
  });
}

function managedUsername(loginOutput) {
  for (const line of loginOutput.split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      const event = JSON.parse(line);
      if (
        event.event === "authenticated" &&
        typeof event.user?.username === "string"
      ) {
        return event.user.username;
      }
    } catch {
      // Ignore non-JSON progress output. It is intentionally never printed.
    }
  }

  return null;
}

function loginAndVerify() {
  const login = run([
    "exec",
    "create-launch",
    "login",
    "--session",
    sessionSecret,
    "--json",
  ]);
  if (login.status !== 0) return false;

  const expectedUsername = managedUsername(login.stdout);
  if (!expectedUsername) return false;

  const whoami = run(["exec", "expo", "whoami"]);
  return whoami.status === 0 && whoami.stdout.trim() === expectedUsername;
}

if (!loginAndVerify() && !loginAndVerify()) {
  console.warn(warning);
}
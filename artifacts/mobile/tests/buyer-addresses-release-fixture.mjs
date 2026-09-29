const apiBaseUrl = (process.env.NATIVE_BUYER_ADDRESSES_API_BASE_URL ?? "").replace(/\/$/, "");
const controlToken = process.env.NATIVE_BUYER_ADDRESSES_CONTROL_TOKEN?.trim();
const clerkSecretKey = process.env.NATIVE_BUYER_ADDRESSES_CLERK_SECRET_KEY?.trim();

function required(name, value) {
  if (!value) throw new Error(`Buyer-address release fixture requires ${name}`);
  return value;
}

export function accountCredentials() {
  const raw = required(
    "NATIVE_BUYER_ADDRESSES_DISPOSABLE_ACCOUNT",
    process.env.NATIVE_BUYER_ADDRESSES_DISPOSABLE_ACCOUNT?.trim(),
  );
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "NATIVE_BUYER_ADDRESSES_DISPOSABLE_ACCOUNT must be JSON with email and password",
    );
  }
  if (typeof parsed?.email !== "string" || !parsed.email.includes("@")) {
    throw new Error("Disposable buyer account JSON requires a valid email");
  }
  if (typeof parsed?.password !== "string" || parsed.password.length < 8) {
    throw new Error("Disposable buyer account JSON requires a password of at least 8 characters");
  }
  return { email: parsed.email.trim().toLowerCase(), password: parsed.password };
}

function labels() {
  const values = (process.env.NATIVE_BUYER_ADDRESS_LABELS ?? "Home,Office")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  if (values.length !== 2) throw new Error("Release checks require exactly two address labels");
  return values;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (response.ok) throw new Error(`${options.method ?? "GET"} request returned invalid JSON`);
  }
  if (!response.ok) {
    const requestTarget = new URL(url);
    throw new Error(
      `${options.method ?? "GET"} ${requestTarget.origin}${requestTarget.pathname} failed (${response.status})`,
    );
  }
  return body;
}

function clerkRequest(path, options = {}) {
  return jsonRequest(`https://api.clerk.com/v1${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${required("NATIVE_BUYER_ADDRESSES_CLERK_SECRET_KEY", clerkSecretKey)}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
}

function controlRequest(path, body) {
  return jsonRequest(
    `${required("NATIVE_BUYER_ADDRESSES_API_BASE_URL", apiBaseUrl)}/api/v1/release-test-control${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-release-test-control-token": required(
          "NATIVE_BUYER_ADDRESSES_CONTROL_TOKEN",
          controlToken,
        ),
      },
      body: JSON.stringify(body),
    },
  );
}

async function findUser(email) {
  const result = await clerkRequest(`/users?email_address=${encodeURIComponent(email)}&limit=1`);
  return Array.isArray(result) ? result[0] : result?.data?.[0];
}

async function ensureUser() {
  const { email, password } = accountCredentials();
  let user = await findUser(email);
  const created = !user;
  if (!user) {
    user = await clerkRequest("/users", {
      method: "POST",
      body: JSON.stringify({
        email_address: [email],
        password,
        first_name: "Release Check",
        last_name: "Buyer",
        skip_password_checks: true,
        skip_password_requirement: true,
      }),
    });
  } else {
    user = await clerkRequest(`/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ password, skip_password_checks: true }),
    });
  }
  return { id: user.id, email, created };
}

async function listSessions(userId) {
  const result = await clerkRequest(`/sessions?user_id=${encodeURIComponent(userId)}&limit=100`);
  return Array.isArray(result) ? result : result?.data ?? [];
}

async function revokeSessions(userId) {
  for (const session of await listSessions(userId)) {
    if (session?.id) {
      await clerkRequest(`/sessions/${encodeURIComponent(session.id)}/revoke`, { method: "POST" });
    }
  }
}

export async function prepareBuyerAddressFixture() {
  const account = await ensureUser();
  const fixtureAccount = { id: account.id, created: account.created };
  try {
    await revokeSessions(account.id);
    await controlRequest("/buyer-addresses/prepare", {
      buyerId: account.id,
      email: account.email,
      labels: labels(),
    });
    return fixtureAccount;
  } catch (error) {
    error.fixtureAccount = fixtureAccount;
    throw error;
  }
}

export async function armBuyerAddressFailure(account) {
  await controlRequest("/buyer-addresses/arm-failure", { buyerId: account.id });
}

export async function cleanupBuyerAddressFixture(account) {
  if (!account?.id) return;
  let failure;
  try {
    await controlRequest("/buyer-addresses/cleanup", { buyerId: account.id });
  } catch (error) {
    failure = error;
  }
  try {
    await revokeSessions(account.id);
    await clerkRequest(`/users/${encodeURIComponent(account.id)}`, { method: "DELETE" });
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "Fixture data and session cleanup failed")
      : error;
  }
  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const command = process.argv[2];
  const account = await ensureUser();
  if (command === "prepare") await prepareBuyerAddressFixture();
  else if (command === "arm-failure") await armBuyerAddressFailure(account);
  else if (command === "cleanup") await cleanupBuyerAddressFixture(account);
  else throw new Error("Usage: buyer-addresses-release-fixture.mjs prepare|arm-failure|cleanup");
}
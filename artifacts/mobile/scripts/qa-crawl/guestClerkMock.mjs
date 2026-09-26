/**
 * Best-effort mock of Clerk's frontend bootstrapping for the guest (signed-
 * out) crawl role. See docs/qa/full-crawl-report.md ("Guest role" section)
 * for the full writeup of what this does and does not unblock.
 *
 * Background: @clerk/expo's web provider renders a real <script> tag that
 * loads the actual @clerk/clerk-js browser bundle from
 * `https://<frontend-api-domain>/npm/@clerk/clerk-js@<major>/dist/clerk.browser.js`.
 * In this sandbox, the fake pk_test_* key's encoded frontend-api domain
 * doesn't resolve (and even a real domain would be blocked by the sandbox's
 * network egress policy), so that request fails outright and `ClerkLoaded`
 * (which every screen behind auth waits on) never fires -- the app is stuck
 * on the boot logo forever. Pass 1 documented this as an unstudied dead end.
 *
 * This module goes one step further: it intercepts that script request and
 * serves the REAL, locally-installed @clerk/clerk-js bundle from
 * node_modules (same package/version the app depends on) instead of letting
 * it fail, then also stubs the `@clerk/ui` companion bundle clerk-js lazily
 * loads for its prebuilt UI components (also unreachable in-sandbox).
 *
 * Result of that: `window.Clerk` is now constructed (version reports
 * correctly) and its `.status` moves to "loading" without throwing -- so the
 * lazy-bundle 404/DNS failure is no longer the blocker. HOWEVER, clerk-js's
 * own `load()` never proceeds to make its expected `GET /v1/environment` /
 * `GET or POST /v1/client` calls to the frontend API at all (confirmed via an
 * unfiltered `context.route("**\/*")` listener across many seconds --
 * nothing beyond the two script loads above is ever requested, and no
 * iframe is created for Clerk's dev-browser handshake either). `.status`
 * stays "loading" indefinitely and `ClerkLoaded` never fires. We were not
 * able to identify, within the time budgeted for this pass, exactly what
 * internal precondition clerk-js@6 is waiting on before it will even attempt
 * that first network call (candidates not yet ruled out: an `isSatellite`/
 * `proxyUrl`/`instanceType` config-validation branch bailing out silently
 * for a synthetic key that doesn't match Clerk's real key-encoding checksum,
 * or a `requestIdleCallback`-gated deferral that a headless Chromium context
 * never fires). So this is a REAL step forward (the app no longer just fails
 * to load a script) but still does NOT get guest crawling past the boot
 * screen.
 *
 * Usage (wire into a Playwright BrowserContext before any navigation):
 *   import { installGuestClerkMock } from "./guestClerkMock.mjs";
 *   await installGuestClerkMock(context);
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function resolveClerkJsBundle() {
  try {
    // Resolve whatever version is actually installed, rather than hardcoding
    // a version path that will silently go stale on a dependency bump.
    return require.resolve("@clerk/clerk-js/dist/clerk.browser.js", {
      paths: [process.cwd()],
    });
  } catch {
    return null;
  }
}

export async function installGuestClerkMock(context) {
  const bundlePath = resolveClerkJsBundle();
  const clerkJs = bundlePath ? fs.readFileSync(bundlePath, "utf8") : null;

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (/\/npm\/@clerk\/clerk-js@\d+\/dist\/clerk\.browser\.js/.test(url) && clerkJs) {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: clerkJs });
      return;
    }
    if (/\/npm\/@clerk\/ui@\d+\/dist\/ui\.browser\.js/.test(url)) {
      // Must be syntactically valid *non-module* JS -- clerk-js injects this
      // as a plain <script> tag, not type="module", so `export {}` throws a
      // SyntaxError that (previously) aborted the whole load() promise chain.
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "/* qa-mock: @clerk/ui stub */" });
      return;
    }
    await route.continue();
  });

  return { bundleFound: !!clerkJs, bundlePath };
}

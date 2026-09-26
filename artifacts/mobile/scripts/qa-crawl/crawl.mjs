#!/usr/bin/env node
/**
 * QA breadth-first crawler for the Expo web build.
 *
 * See docs/qa/full-crawl-report.md ("Harness" section) for the full writeup:
 * what mock-auth mechanism this uses, how to rerun it, and its known gaps.
 *
 * Summary of the approach:
 *   - Buyer / seller "sign-in" is faked with the app's own existing dev
 *     preview bypass: loading the web build with ?bt_preview=buyer or
 *     ?bt_preview=seller (see artifacts/mobile/app/_layout.tsx / lib/devPreview.ts).
 *     This is a pre-existing, __DEV__-gated, web-only mechanism — nothing new
 *     was added to the mobile app to support it. It skips Clerk/onboarding
 *     entirely, so the app renders the real buyer/seller shell without a
 *     network round trip to Clerk.
 *   - Because that bypass is purely client-side, real API calls the screens
 *     make still need a request to actually authenticate. The api-server has
 *     no way to verify a fake Clerk session either (no real Clerk keys are
 *     available in this sandbox), so a small, explicitly-gated bypass was
 *     added to artifacts/api-server/src/middlewares/requireAuth.ts: when
 *     NODE_ENV !== "production" AND ENABLE_QA_AUTH_BYPASS === "true", a
 *     request carrying an `x-qa-user-id` header is trusted as that clerkId.
 *     This crawler cannot set that header from the browser (fetches are made
 *     by the app's own code), so instead it's injected as a `page.route`
 *     interceptor that stamps every same-origin API request with the header
 *     for the current role. Guest crawls send no header and get real 401s,
 *     which is the intended guest experience.
 *   - Guest = no bt_preview param at all -> real splash/sign-in screen.
 *
 * Usage:
 *   BASE_URL=http://localhost:8081 API_BASE_URL=http://localhost:5050 \
 *     node scripts/qa-crawl/crawl.mjs [--role buyer|seller|guest] [--max-pages N] [--viewport 390x844]
 *
 * Wired up as `pnpm qa:crawl` (mobile package.json) and `pnpm --filter @workspace/mobile run qa:crawl` from the repo root.
 */
import { chromium } from "playwright";
import { installGuestClerkMock } from "./guestClerkMock.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SCREENSHOT_DIR = path.join(REPO_ROOT, "docs/qa/screenshots");
const RESULTS_PATH = path.join(REPO_ROOT, "docs/qa/crawl-results.json");

const BASE_URL = process.env.BASE_URL || "http://localhost:8081";
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5050";
const QA_USER_IDS = {
  buyer: "qa-seed-buyer-1",
  seller: "qa-seed-seller-1",
  guest: null,
};

const VIEWPORTS = [
  { name: "iphone-390x844", width: 390, height: 844 },
  { name: "iphone-375x667", width: 375, height: 667 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

// Clicking every element on every page (opening a fresh browser page per
// click, to isolate state) is the single most expensive part of the crawl.
// Cap it so a full run stays tractable; see report "Harness" limitations.
const CLICK_BUDGET_PER_PAGE = Number(process.env.QA_CLICK_BUDGET || 25);
// A "lite" pass (used for the two secondary viewports) skips per-element
// click-BFS and form/toggle testing entirely -- just nav + screenshot +
// layout/console/network checks. Full click-BFS is reserved for the primary
// viewport to keep wall-clock time tractable across ~260 routes x 3
// viewports x 2 roles.
const LITE_MODE = process.env.QA_LITE === "1";
const SLOW_THRESHOLD_MS = Number(process.env.QA_SLOW_MS || 1000);

const TAB_ROOTS = {
  buyer: ["/(buyer)", "/(buyer)/discover", "/(buyer)/inbox", "/(buyer)/search", "/(buyer)/profile"],
  seller: ["/(tabs)", "/(tabs)/products", "/(tabs)/orders", "/(tabs)/profile"],
  guest: ["/"],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { role: null, maxPages: 25, viewport: null, routesFile: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--role") opts.role = args[++i];
    else if (args[i] === "--max-pages") opts.maxPages = Number(args[++i]);
    else if (args[i] === "--viewport") opts.viewport = args[++i];
    else if (args[i] === "--routes-file") opts.routesFile = args[++i];
  }
  return opts;
}

// Loads the statically-enumerated route list produced by routeList.mjs and
// filters out routes that obviously belong to the other role's route group
// (a (tabs)/... file for the buyer role, a (buyer)/... file for seller), so
// the seed queue is role-appropriate. Guest gets the full list minus both
// role-gated groups, since none of those tabs exist for a signed-out user.
function loadSeedRoutes(routesFile, role) {
  if (!routesFile || !fs.existsSync(routesFile)) return [];
  const entries = JSON.parse(fs.readFileSync(routesFile, "utf8"));
  const filtered = entries.filter((e) => {
    if (role === "buyer") return !e.file.startsWith("/(tabs)");
    if (role === "seller") return !e.file.startsWith("/(buyer)");
    return !e.file.startsWith("/(tabs)") && !e.file.startsWith("/(buyer)");
  });
  return filtered.map((e) => e.route);
}

function normalizeRoute(url) {
  try {
    const u = new URL(url);
    // Drop the bt_preview param from the dedup key (it's constant per role)
    // but keep other query params, since they usually carry route state
    // (product id, order id, etc.) that Expo Router encodes as querystring
    // on web for dynamic segments.
    const params = new URLSearchParams(u.search);
    params.delete("bt_preview");
    const qs = params.toString();
    return u.pathname + (qs ? `?${qs}` : "");
  } catch {
    return url;
  }
}

async function collectInteractiveElements(page) {
  // React Native Web renders Pressable/TouchableOpacity as <div role="button">
  // or plain clickable <div>s with onClick. We collect a broad net of
  // candidate selectors and de-dupe by bounding box + accessible name so the
  // same element isn't queued twice under two selectors.
  const selector = [
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="menuitem"]',
    "button",
    "a[href]",
    "[data-testid]",
  ].join(",");

  const handles = await page.$$(selector);
  const seen = new Set();
  const out = [];
  for (const handle of handles) {
    const box = await handle.boundingBox().catch(() => null);
    if (!box || box.width === 0 || box.height === 0) continue; // hidden / zero-size
    const key = `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = await handle.evaluate((el) => {
      return (
        el.getAttribute("aria-label") ||
        el.getAttribute("data-testid") ||
        (el.textContent || "").trim().slice(0, 60) ||
        el.tagName
      );
    });
    out.push({ handle, box, label });
  }
  return out;
}

function findTruncatedText(page) {
  return page.evaluate(() => {
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    let count = 0;
    while (node && count < 4000) {
      count++;
      if (
        node.scrollWidth > node.clientWidth + 2 &&
        node.clientWidth > 0 &&
        node.children.length === 0 &&
        (node.textContent || "").trim().length > 0
      ) {
        const style = window.getComputedStyle(node);
        if (style.overflow !== "visible" || style.textOverflow === "ellipsis") {
          results.push((node.textContent || "").trim().slice(0, 80));
        }
      }
      node = walker.nextNode();
    }
    return results.slice(0, 20);
  });
}

function findOffscreenOrOverlapped(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const issues = [];
    const clickable = Array.from(document.querySelectorAll('[role="button"], button, a[href]'));
    for (const el of clickable.slice(0, 300)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) {
        issues.push({
          type: "offscreen",
          label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 60),
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        });
      }
    }
    return issues.slice(0, 20);
  });
}

function findHeader(page) {
  return page.evaluate(() => {
    // Heuristic: the largest-font, near-top text node that isn't inside a
    // scroll container far down the page. Expo Router's web headers render
    // as a plain <div>/<span> stack, not semantic <header>, so we look at
    // role=heading first and fall back to the biggest text in the top 120px.
    const heading = document.querySelector('[role="heading"], h1, h2');
    const candidates = heading ? [heading] : Array.from(document.querySelectorAll("div,span")).slice(0, 400);
    let best = null;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.top > 140 || r.height === 0) continue;
      const text = (el.textContent || "").trim();
      if (!text || text.length > 40) continue;
      const style = window.getComputedStyle(el);
      const fontSize = parseFloat(style.fontSize) || 0;
      if (!best || fontSize > best.fontSize) {
        best = { text: text.slice(0, 40), fontSize, x: r.x, y: r.y, w: r.width, h: r.height };
      }
    }
    return best;
  });
}

function findToggles(page) {
  return page.$$('[role="switch"], input[type="checkbox"], [role="checkbox"]');
}

async function testToggles(page, findingsEntry) {
  const toggles = await findToggles(page);
  const results = [];
  for (const t of toggles.slice(0, 10)) {
    try {
      const before = await t.evaluate(
        (el) => el.getAttribute("aria-checked") ?? el.checked ?? null
      );
      await t.click({ timeout: 2000 });
      await page.waitForTimeout(200);
      const after = await t.evaluate(
        (el) => el.getAttribute("aria-checked") ?? el.checked ?? null
      );
      results.push({ before, after, changed: String(before) !== String(after) });
    } catch (e) {
      results.push({ error: String(e).slice(0, 120) });
    }
  }
  findingsEntry.toggleResults = results;
}

async function findForms(page) {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input, textarea"));
    return inputs
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && el.type !== "hidden";
      })
      .map((el, i) => ({
        index: i,
        type: el.type || el.tagName.toLowerCase(),
        name: el.name || el.id || el.getAttribute("aria-label") || "",
      }));
  });
}

function valueFor(type, valid) {
  if (!valid) {
    if (type === "email") return "not-an-email";
    if (type === "number") return "-1";
    return "";
  }
  if (type === "email") return "qa+valid@example.com";
  if (type === "number") return "10";
  if (type === "password") return "QaTestPass123!";
  return "QA test value";
}

async function testForm(page, target, findingsEntry, opts) {
  const inputs = await page.$$("input, textarea");
  const visible = [];
  for (const inp of inputs) {
    const box = await inp.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) visible.push(inp);
  }
  if (visible.length === 0) {
    findingsEntry.formTest = { present: false };
    return;
  }
  const submitCandidates = page.locator(
    'button, [role="button"]'
  ).filter({ hasText: /submit|save|continue|next|create|confirm|sign up|sign in|send|post|checkout|place order|add/i });

  async function fillAndSubmit(valid) {
    const inps = await page.$$("input, textarea");
    for (const inp of inps) {
      const box = await inp.boundingBox().catch(() => null);
      if (!box || box.width === 0) continue;
      const type = await inp.evaluate((el) => el.type || el.tagName.toLowerCase()).catch(() => "text");
      if (type === "checkbox" || type === "radio" || type === "file") continue;
      const val = valueFor(type, valid);
      try {
        await inp.fill(String(val), { timeout: 1500 });
      } catch {}
    }
    let submitted = false;
    try {
      const count = await submitCandidates.count();
      if (count > 0) {
        await submitCandidates.first().click({ timeout: 2000 });
        submitted = true;
        await page.waitForTimeout(1000);
      }
    } catch {}
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => "");
    return { submitted, resultTextSample: bodyText.slice(0, 400) };
  }

  const validResult = await fillAndSubmit(true).catch((e) => ({ error: String(e).slice(0, 150) }));
  // Fresh reload before the invalid pass so the valid submission's side
  // effects (e.g. navigating away) don't contaminate it.
  let invalidResult = null;
  try {
    await page.goto(target, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);
    invalidResult = await fillAndSubmit(false);
  } catch (e) {
    invalidResult = { error: String(e).slice(0, 150) };
  }

  findingsEntry.formTest = {
    present: true,
    fieldCount: visible.length,
    valid: validResult,
    invalid: invalidResult,
  };
}

async function testScrollBottom(page, viewport) {
  const result = await page.evaluate((vh) => {
    window.scrollTo(0, document.body.scrollHeight);
    const scrolled = window.scrollY > 0 || document.documentElement.scrollTop > 0;
    // Find a plausible fixed/sticky bottom bar (tab bar).
    const all = Array.from(document.querySelectorAll("div"));
    let tabBar = null;
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if ((style.position === "fixed" || style.position === "sticky") ) {
        const r = el.getBoundingClientRect();
        if (r.bottom >= vh - 4 && r.bottom <= vh + 4 && r.width > vh * 0.5) {
          tabBar = r;
          break;
        }
      }
    }
    let overlap = null;
    if (tabBar) {
      for (const el of all.slice(0, 600)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.bottom > tabBar.top + 2 && r.top < tabBar.bottom && r.bottom > tabBar.top && el.textContent && el.textContent.trim()) {
          // an element extends behind the tab bar zone
          if (r.top < tabBar.top - 2 && r.bottom > tabBar.top + 4) {
            overlap = { text: (el.textContent || "").trim().slice(0, 60) };
            break;
          }
        }
      }
    }
    return { scrolledToBottom: scrolled, tabBarFound: !!tabBar, possibleTabBarOverlap: overlap };
  }, viewport.height).catch(() => ({}));
  return result;
}

async function testBackNav(page, target) {
  try {
    const before = page.url();
    await page.goBack({ waitUntil: "networkidle", timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    const after = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "");
    const isDeadEnd = after === before && /not found|404/i.test(bodyText);
    return { before, after, changed: before !== after, isDeadEnd };
  } catch (e) {
    return { error: String(e).slice(0, 150) };
  }
}

async function crawlRole(browser, role, viewport, maxPages, seedRoutes, onFlush) {
  let context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) QA-Crawler/1.0",
  });

  if (role === "guest") {
    // Best-effort Clerk frontend-API mock -- see guestClerkMock.mjs for what
    // this does and does not unblock. Applied unconditionally for guest so
    // any future clerk-js version that DOES get further past this gate is
    // picked up automatically.
    const mockResult = await installGuestClerkMock(context);
    if (!mockResult.bundleFound) {
      console.warn("  [guest] @clerk/clerk-js bundle not found in node_modules -- mock inert");
    }
  }

  const qaUserId = QA_USER_IDS[role];
  if (qaUserId) {
    // Stamp every same-origin API call with the QA auth-bypass header so the
    // seeded buyer/seller's real data is returned. See file header.
    await context.route(`${API_BASE_URL}/**`, async (route) => {
      const headers = { ...route.request().headers(), "x-qa-user-id": qaUserId };
      await route.continue({ headers });
    });
  }

  const findings = [];
  const visited = new Set();
  const queue = [
    ...TAB_ROOTS[role].map((r) => ({ route: r, depth: 0, from: "start" })),
    ...seedRoutes.map((r) => ({ route: r, depth: 0, from: "static-route-list" })),
  ];

  let pagesVisited = 0;

  // Playwright/CDP occasionally wedges in this sandbox (a page's renderer
  // process dies without the CDP pipe surfacing an error), and several calls
  // below (page.evaluate, etc.) have no built-in timeout of their own -- a
  // single wedged page would otherwise hang the entire multi-hundred-route
  // crawl forever. PAGE_TIMEOUT_MS bounds worst-case time-per-route: if it's
  // hit, the route is recorded as a timeout finding (not silently dropped)
  // and the loop moves on to the next one.
  const PAGE_TIMEOUT_MS = 90000;

  while (queue.length && pagesVisited < maxPages) {
    const { route, depth, from } = queue.shift();
    const key = normalizeRoute(route);
    if (visited.has(key)) continue;
    if (depth > 6) continue;
    visited.add(key);
    pagesVisited++;

    let timedOut = false;
    const watchdog = new Promise((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve("timeout");
      }, PAGE_TIMEOUT_MS);
    });

    const pageResult = await Promise.race([
      processRoute({ context, route, key, depth, from, viewport, role, qaUserId, findings, pagesVisited }),
      watchdog,
    ]);

    if (pageResult === "timeout") {
      findings.push({
        role,
        viewport: viewport.name,
        route: key,
        reachedFrom: from,
        navError: `PAGE_TIMEOUT: exceeded ${PAGE_TIMEOUT_MS}ms -- likely a wedged browser page/CDP connection, not a real app hang. Route abandoned so the crawl could continue.`,
        loadTimeMs: PAGE_TIMEOUT_MS,
        slow: true,
        consoleErrors: [],
        pageErrors: [],
        networkErrors: [],
        stillSpinning: false,
        truncatedTextSamples: [],
        offscreenElements: [],
        looksBlank: false,
        looksLikeErrorBoundary: false,
        header: null,
        scrollBottom: {},
        screenshot: null,
        candidateDeadClicks: [],
        unclosableSheets: [],
        interactiveElementCount: 0,
        harnessTimeout: true,
      });
      // A wedged page/context is unrecoverable in place -- recreate the
      // browser context (and reinstall the auth-bypass route handler) so the
      // next route gets a clean slate instead of also hanging.
      try {
        await context.close();
      } catch {}
      context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) QA-Crawler/1.0",
      });
      if (role === "guest") {
        await installGuestClerkMock(context).catch(() => {});
      }
      if (qaUserId) {
        await context.route(`${API_BASE_URL}/**`, async (route2) => {
          const headers = { ...route2.request().headers(), "x-qa-user-id": qaUserId };
          await route2.continue({ headers });
        });
      }
    } else if (pageResult && pageResult.childRoutes) {
      for (const child of pageResult.childRoutes) {
        if (!visited.has(normalizeRoute(child.route))) queue.push(child);
      }
    }

    if (onFlush && pagesVisited % 5 === 0) onFlush(findings);
  }

  try {
    await context.close();
  } catch {}
  if (onFlush) onFlush(findings);
  return findings;
}

async function processRoute({ context, route, key, depth, from, viewport, role, qaUserId, findings, pagesVisited }) {
  const childRoutes = [];
  {
    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];
    const pageErrors = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));
    page.on("response", (res) => {
      const status = res.status();
      if (status >= 400) {
        networkErrors.push({ url: res.url().slice(0, 200), status });
      }
    });

    // Build the navigation target as an absolute URL against BASE_URL, and
    // make sure ?bt_preview=<role> is present on EVERY navigation (including
    // routes discovered mid-crawl by clicking, which arrive here as full
    // http(s) URLs from page.url() and would otherwise drop the preview
    // param on reload — losing the buyer/seller mock session entirely and
    // falling back to the real, blank, signed-out boot screen).
    const targetUrl = new URL(route, BASE_URL);
    if (qaUserId) {
      targetUrl.searchParams.set("bt_preview", role);
    }
    const target = targetUrl.toString();

    let navError = null;
    const navStart = Date.now();
    try {
      await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
    } catch (e) {
      navError = String(e).slice(0, 300);
    }
    const loadTimeMs = Date.now() - navStart;
    await page.waitForTimeout(1500);

    // Dismiss known first-load overlays that would otherwise mask every
    // subsequent screenshot/interaction on a fresh context: the cookie
    // consent banner ("Accept all") and the one-time feed gesture tutorial
    // (any tap dismisses it — see components/FeedGestureGuide.tsx).
    try {
      const acceptAll = page.getByText("Accept all", { exact: true });
      if (await acceptAll.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await acceptAll.first().click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
    } catch {}
    try {
      const tapToKeepWatching = page.getByText("Tap to keep watching");
      if (await tapToKeepWatching.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await page.mouse.click(viewport.width / 2, viewport.height / 2);
        await page.waitForTimeout(300);
      }
    } catch {}

    const screenshotName = `${role}-${viewport.name}-${pagesVisited}-${key
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .slice(0, 60)}.png`;
    const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

    // Spinner-still-spinning-after-10s heuristic: re-check for common
    // loading indicators after an additional wait.
    let stillSpinning = false;
    try {
      const spinnerCountBefore = await page
        .locator('[aria-busy="true"], [role="progressbar"]')
        .count();
      if (spinnerCountBefore > 0) {
        await page.waitForTimeout(8500);
        const spinnerCountAfter = await page
          .locator('[aria-busy="true"], [role="progressbar"]')
          .count();
        stillSpinning = spinnerCountAfter > 0;
      }
    } catch {}

    const truncated = await findTruncatedText(page).catch(() => []);
    const offscreen = await findOffscreenOrOverlapped(page).catch(() => []);
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "");
    const looksBlank = bodyText.trim().length < 20;
    const looksLikeErrorBoundary = /something went wrong|unexpected error|error boundary/i.test(bodyText);
    const header = await findHeader(page).catch(() => null);
    const scrollBottom = await testScrollBottom(page, viewport).catch(() => ({}));

    const entry = {
      role,
      viewport: viewport.name,
      route: key,
      reachedFrom: from,
      navError,
      loadTimeMs,
      slow: loadTimeMs > SLOW_THRESHOLD_MS,
      consoleErrors: consoleErrors.slice(0, 10),
      pageErrors: pageErrors.slice(0, 10),
      networkErrors: networkErrors.slice(0, 20),
      stillSpinning,
      truncatedTextSamples: truncated,
      offscreenElements: offscreen,
      looksBlank,
      looksLikeErrorBoundary,
      header,
      scrollBottom,
      screenshot: path.relative(REPO_ROOT, screenshotPath),
    };
    findings.push(entry);

    if (!LITE_MODE) {
      await testToggles(page, entry).catch(() => {});
      await testForm(page, target, entry).catch((e) => {
        entry.formTest = { error: String(e).slice(0, 150) };
      });
      // Form testing and toggle testing may have navigated the page or left
      // it mid-submit; re-navigate to a clean copy of the target before back
      // nav so the "before" state is well-defined.
      try {
        await page.goto(target, { waitUntil: "networkidle", timeout: 20000 });
        await page.waitForTimeout(500);
      } catch {}
      entry.backNav = await testBackNav(page, target).catch((e) => ({ error: String(e).slice(0, 120) }));
    }

    // React Native Web renders navigable elements as role="button" divs with
    // onClick handlers, not <a href> — so route discovery has to be done by
    // actually clicking each candidate and watching the URL, rather than by
    // reading hrefs out of the DOM. Each click gets a fresh reload of the
    // parent route first so one click's side effects can't contaminate the
    // next (a modal left open, scroll position, etc).
    const deadClicks = [];
    const unclosableSheets = [];
    if (depth < 6 && !LITE_MODE) {
      const elements = await collectInteractiveElements(page);
      const budget = elements.slice(0, CLICK_BUDGET_PER_PAGE);
      for (const el of budget) {
        const freshPage = await context.newPage();
        try {
          await freshPage.goto(target, { waitUntil: "networkidle", timeout: 20000 });
          await freshPage.waitForTimeout(1000);
          // Re-dismiss overlays on this fresh instance too.
          const accept = freshPage.getByText("Accept all", { exact: true });
          if (await accept.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await accept.first().click({ timeout: 1500 }).catch(() => {});
          }
          const tap = freshPage.getByText("Tap to keep watching");
          if (await tap.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await freshPage.mouse.click(viewport.width / 2, viewport.height / 2);
          }
          await freshPage.waitForTimeout(300);

          const beforeUrl = freshPage.url();
          await freshPage.mouse.click(el.box.x + el.box.width / 2, el.box.y + el.box.height / 2);
          await freshPage.waitForTimeout(1200);
          const afterUrl = freshPage.url();

          if (afterUrl !== beforeUrl) {
            childRoutes.push({ route: afterUrl, depth: depth + 1, from: `${key} -> click "${el.label}"` });
          } else {
            // No navigation. Could be a genuine same-screen action (opened a
            // sheet/toggled state) or a dead button. We can't tell the two
            // apart from the URL alone, so we only flag it as a candidate
            // dead click when the visible text didn't change either.
            const afterText = await freshPage
              .evaluate(() => document.body.innerText.slice(0, 2000))
              .catch(() => "");
            if (afterText === bodyText) {
              deadClicks.push(el.label);
            } else {
              // Visible text changed with no URL change: likely a sheet/modal/
              // menu opened. Try to close it via a close/X button, Escape, or
              // a backdrop tap; flag if none works.
              let closed = false;
              try {
                const closeBtn = freshPage
                  .locator('[aria-label*="close" i], [data-testid*="close" i]')
                  .first();
                if (await closeBtn.isVisible({ timeout: 800 }).catch(() => false)) {
                  await closeBtn.click({ timeout: 1500 }).catch(() => {});
                  await freshPage.waitForTimeout(400);
                }
              } catch {}
              if (!closed) {
                const midText = await freshPage.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "");
                closed = midText === bodyText;
              }
              if (!closed) {
                await freshPage.keyboard.press("Escape").catch(() => {});
                await freshPage.waitForTimeout(400);
                const midText2 = await freshPage.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "");
                closed = midText2 === bodyText;
              }
              if (!closed) {
                // Backdrop tap: click near a corner unlikely to be the sheet content.
                await freshPage.mouse.click(4, 4).catch(() => {});
                await freshPage.waitForTimeout(400);
                const midText3 = await freshPage.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => "");
                closed = midText3 === bodyText;
              }
              if (!closed) {
                unclosableSheets.push(el.label);
              }
            }
          }
        } catch (e) {
          deadClicks.push(`${el.label} (click threw: ${String(e).slice(0, 120)})`);
        } finally {
          await freshPage.close().catch(() => {});
        }
      }
    }
    findings[findings.length - 1].candidateDeadClicks = deadClicks.slice(0, 15);
    findings[findings.length - 1].unclosableSheets = unclosableSheets.slice(0, 15);
    findings[findings.length - 1].interactiveElementCount = (
      await collectInteractiveElements(page).catch(() => [])
    ).length;

    await page.close().catch(() => {});
  }

  return { childRoutes };
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const opts = parseArgs();
  const roles = opts.role ? [opts.role] : ["buyer", "seller", "guest"];
  const viewports = opts.viewport
    ? VIEWPORTS.filter((v) => v.name.includes(opts.viewport) || `${v.width}x${v.height}` === opts.viewport)
    : VIEWPORTS;

  const outPath = process.env.QA_RESULTS_PATH || RESULTS_PATH;
  const browser = await chromium.launch();
  // Append to any existing results from a previous invocation (e.g. a
  // separate process per role/viewport combo, run so a crash in one doesn't
  // lose the others' progress) rather than clobbering them, unless
  // QA_FRESH_RESULTS=1 is set.
  let allFindings = [];
  if (process.env.QA_FRESH_RESULTS !== "1" && fs.existsSync(outPath)) {
    try {
      allFindings = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch {
      allFindings = [];
    }
  }

  for (const role of roles) {
    for (const viewport of viewports) {
      console.log(`\n=== Crawling role=${role} viewport=${viewport.name} (lite=${LITE_MODE}) ===`);
      const seedRoutes = loadSeedRoutes(opts.routesFile, role);
      console.log(`  seeded ${seedRoutes.length} static routes`);
      const baseline = allFindings.length;
      const findings = await crawlRole(browser, role, viewport, opts.maxPages, seedRoutes, (partial) => {
        fs.writeFileSync(outPath, JSON.stringify([...allFindings.slice(0, baseline), ...partial], null, 2));
      });
      allFindings = [...allFindings.slice(0, baseline), ...findings];
      console.log(`  visited ${findings.length} routes`);
      fs.writeFileSync(outPath, JSON.stringify(allFindings, null, 2));
    }
  }

  await browser.close();

  fs.writeFileSync(outPath, JSON.stringify(allFindings, null, 2));
  console.log(`\nWrote ${allFindings.length} page records to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

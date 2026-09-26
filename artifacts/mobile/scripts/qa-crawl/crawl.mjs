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
const CLICK_BUDGET_PER_PAGE = Number(process.env.QA_CLICK_BUDGET || 8);

const TAB_ROOTS = {
  buyer: ["/(buyer)", "/(buyer)/discover", "/(buyer)/inbox", "/(buyer)/search", "/(buyer)/profile"],
  seller: ["/(tabs)", "/(tabs)/products", "/(tabs)/orders", "/(tabs)/profile"],
  guest: ["/"],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { role: null, maxPages: 25, viewport: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--role") opts.role = args[++i];
    else if (args[i] === "--max-pages") opts.maxPages = Number(args[++i]);
    else if (args[i] === "--viewport") opts.viewport = args[++i];
  }
  return opts;
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

async function crawlRole(browser, role, viewport, maxPages) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) QA-Crawler/1.0",
  });

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
  const queue = TAB_ROOTS[role].map((r) => ({ route: r, depth: 0, from: "start" }));

  let pagesVisited = 0;

  while (queue.length && pagesVisited < maxPages) {
    const { route, depth, from } = queue.shift();
    const key = normalizeRoute(route);
    if (visited.has(key)) continue;
    if (depth > 6) continue;
    visited.add(key);
    pagesVisited++;

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
    try {
      await page.goto(target, { waitUntil: "networkidle", timeout: 30000 });
    } catch (e) {
      navError = String(e).slice(0, 300);
    }
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

    findings.push({
      role,
      viewport: viewport.name,
      route: key,
      reachedFrom: from,
      navError,
      consoleErrors: consoleErrors.slice(0, 10),
      pageErrors: pageErrors.slice(0, 10),
      networkErrors: networkErrors.slice(0, 20),
      stillSpinning,
      truncatedTextSamples: truncated,
      offscreenElements: offscreen,
      looksBlank,
      looksLikeErrorBoundary,
      screenshot: path.relative(REPO_ROOT, screenshotPath),
    });

    // React Native Web renders navigable elements as role="button" divs with
    // onClick handlers, not <a href> — so route discovery has to be done by
    // actually clicking each candidate and watching the URL, rather than by
    // reading hrefs out of the DOM. Each click gets a fresh reload of the
    // parent route first so one click's side effects can't contaminate the
    // next (a modal left open, scroll position, etc).
    const deadClicks = [];
    if (depth < 6) {
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
            const childKey = normalizeRoute(afterUrl);
            if (!visited.has(childKey)) {
              queue.push({ route: afterUrl, depth: depth + 1, from: `${key} -> click "${el.label}"` });
            }
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
    findings[findings.length - 1].interactiveElementCount = (
      await collectInteractiveElements(page).catch(() => [])
    ).length;

    await page.close();
  }

  await context.close();
  return findings;
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const opts = parseArgs();
  const roles = opts.role ? [opts.role] : ["buyer", "seller", "guest"];
  const viewports = opts.viewport
    ? VIEWPORTS.filter((v) => v.name.includes(opts.viewport) || `${v.width}x${v.height}` === opts.viewport)
    : VIEWPORTS;

  const browser = await chromium.launch();
  const allFindings = [];

  for (const role of roles) {
    for (const viewport of viewports) {
      console.log(`\n=== Crawling role=${role} viewport=${viewport.name} ===`);
      const findings = await crawlRole(browser, role, viewport, opts.maxPages);
      allFindings.push(...findings);
      console.log(`  visited ${findings.length} routes`);
    }
  }

  await browser.close();

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(allFindings, null, 2));
  console.log(`\nWrote ${allFindings.length} page records to ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

/**
 * Text-fit & alignment check for the admin UI (required before any UI PR).
 *
 *   BASE_URL=http://127.0.0.1:5602 node scripts/text-fit-check.mjs [route,route,...]
 *
 * Runs every admin screen at 393x852 (and 1440x900) in headless Chromium and
 * fails on:
 *   - truncated text: scrollWidth > clientWidth, or ellipsis / line-clamp actually clipping
 *     (user-written content may opt out with data-user-content)
 *   - text or child boxes spilling outside their container
 *   - buttons / chips / tabs with < 12px horizontal inner padding around their text
 *   - buttons in one group with different heights, or different widths in a row/grid
 *   - horizontal page scroll
 * Set PLAYWRIGHT_MODULE / CHROME_PATH if playwright isn't resolvable from here.
 */
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const chromium = pw.chromium ?? pw.default.chromium;
const base = process.env.BASE_URL ?? "http://127.0.0.1:5602";
const routes = (process.argv[2] ?? ",users,orders,revenue,ai-spend,moderation,promotions,featured,announcements,invites,audit").split(",");
const viewports = [["393x852", { width: 393, height: 852 }], ["1440x900", { width: 1440, height: 900 }]];

/** Runs inside the page. Returns a list of problems. */
function audit() {
  const problems = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 3).join(".") : ""} "${(el.textContent || "").trim().slice(0, 40)}"`;
  const all = [...document.querySelectorAll("body *")].filter(vis);

  if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${window.innerWidth})`);

  for (const el of all) {
    if (el.closest("[data-user-content]") || el.classList.contains("sr-only")) continue;
    const s = getComputedStyle(el);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText) {
      if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== "visible" ) problems.push(`clipped text: ${desc(el)}`);
      if ((s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none" && s.webkitLineClamp) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) problems.push(`ellipsis truncation: ${desc(el)}`);
      // text must stay inside the element that contains it
      const range = document.createRange(); range.selectNodeContents(el);
      const tr = range.getBoundingClientRect(); const er = el.getBoundingClientRect();
      if (tr.width && (tr.left < er.left - 1 || tr.right > er.right + 1) && s.overflowX === "visible" && !el.matches("td, th")) problems.push(`text overflows its box: ${desc(el)}`);
    }
    // box must stay inside its parent (unless the parent scrolls on purpose)
    const p = el.parentElement;
    if (p && p !== document.body && vis(p) && !el.closest("[role=dialog] > *, .sr-only") && !["fixed", "absolute", "sticky"].includes(s.position)) {
      const ps = getComputedStyle(p);
      const scrolls = ["auto", "scroll"].includes(ps.overflowX) || ["auto", "scroll"].includes(getComputedStyle(el).overflowX);
      const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
      if (!scrolls && (r.right > pr.right + 1 || r.left < pr.left - 1) && r.width <= pr.width * 3) problems.push(`box spills out of parent: ${desc(el)} in ${desc(p)}`);
    }
  }

  // Placeholders are not text nodes: measure them against the input's content box.
  for (const input of [...document.querySelectorAll("input[placeholder], textarea[placeholder]")].filter(vis)) {
    if (input.value) continue;
    const cs = getComputedStyle(input);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const inner = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (input.tagName === "INPUT" && ctx.measureText(input.placeholder).width > inner) problems.push(`placeholder clipped: "${input.placeholder}"`);
  }

  // Buttons / chips / tabs: >= 12px inner padding around the text, text centred.
  const controls = [...document.querySelectorAll("button, [role=tab], a[class*=rounded]")].filter(vis).filter((b) => [...b.childNodes].some((n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && !n.classList.contains("sr-only") && n.tagName !== "svg" && n.textContent.trim())) && !b.closest("nav") && !b.querySelector("svg:only-child"));
  for (const b of controls) {
    const range = document.createRange(); range.selectNodeContents(b);
    const tr = range.getBoundingClientRect(); const br = b.getBoundingClientRect();
    const left = tr.left - br.left, right = br.right - tr.right;
    if (left < 11.5 || right < 11.5) problems.push(`button padding ${left.toFixed(0)}/${right.toFixed(0)}px (<12): ${desc(b)}`);
    if (Math.abs(left - right) > 2.5 && !/justify-(between|start)|text-left/.test(b.className)) problems.push(`button text off-centre (${left.toFixed(0)} vs ${right.toFixed(0)}): ${desc(b)}`);
    const vTop = tr.top - br.top, vBottom = br.bottom - tr.bottom;
    if (Math.abs(vTop - vBottom) > 2.5) problems.push(`button text not vertically centred (${vTop.toFixed(0)} vs ${vBottom.toFixed(0)}): ${desc(b)}`);
  }

  // Sibling buttons in one group: same height, and same width when laid out in a row/grid.
  const groups = new Map();
  for (const b of controls) { const k = b.parentElement; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  for (const [parent, bs] of groups) {
    if (bs.length < 2) continue;
    const rects = bs.map((b) => b.getBoundingClientRect());
    const rows = new Map(); rects.forEach((r, i) => { const k = Math.round(r.top / 4); rows.set(k, [...(rows.get(k) ?? []), i]); });
    const hs = new Set(rects.map((r) => Math.round(r.height)));
    if (hs.size > 1) problems.push(`button group with unequal heights ${[...hs].join("/")}: ${desc(parent)}`);
    const ws = new Set(rects.map((r) => Math.round(r.width)));
    if (ws.size > 1 && !parent.closest("form") ) problems.push(`button group with unequal widths ${[...ws].join("/")}: ${desc(parent)}`);
  }
  return [...new Set(problems)];
}

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
let failed = 0;
for (const [name, viewport] of viewports) {
  const page = await (await browser.newContext({ viewport })).newPage();
  for (const r of routes) {
    await page.goto(`${base}/admin${r ? "/" + r : ""}`);
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(300);
    const found = await page.evaluate(audit);
    if (found.length) { failed += found.length; console.log(`\n✖ ${name} /admin${r ? "/" + r : ""}`); found.forEach((p) => console.log("   - " + p)); }
    else console.log(`✔ ${name} /admin${r ? "/" + r : ""}`);
  }
}
// Overlay states: user detail sheet + suspend dialog, announcement confirm, promotion reject dialog.
const states = [
  ["users", async (page) => { await page.locator("text=Atelier 9 >> visible=true").first().click(); await page.waitForTimeout(500); }, "user sheet"],
  ["users", async (page) => { await page.locator("text=Atelier 9 >> visible=true").first().click(); await page.waitForTimeout(400); await page.getByRole("button", { name: "Suspend account" }).click(); await page.waitForTimeout(400); }, "suspend dialog"],
  ["announcements", async (page) => { await page.getByPlaceholder("Title").fill("Free shipping weekend"); await page.getByPlaceholder("Message").fill("Turn on free shipping for a bonus."); await page.getByRole("button", { name: "Send…" }).click(); await page.waitForTimeout(400); }, "send confirm"],
  ["promotions", async (page) => { await page.getByRole("button", { name: "Reject" }).first().click(); await page.waitForTimeout(400); }, "reject dialog"],
];
for (const [name, viewport] of viewports) {
  const page = await (await browser.newContext({ viewport })).newPage();
  for (const [route, act, label] of states) {
    await page.goto(`${base}/admin/${route}`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(300);
    await act(page);
    const found = await page.evaluate(audit);
    if (found.length) { failed += found.length; console.log(`\n✖ ${name} ${label}`); found.forEach((p) => console.log("   - " + p)); }
    else console.log(`✔ ${name} ${label}`);
  }
}
await browser.close();
console.log(failed ? `\n${failed} text-fit problem(s)` : "\nText-fit check passed");
process.exit(failed ? 1 : 0);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const out = process.env.OUT ?? "shots";
const pages = process.argv[2] ? process.argv[2].split(",") : ["", "users", "orders", "revenue", "ai-spend", "moderation", "promotions", "featured", "announcements", "invites", "audit"];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
for (const [tag, vp] of [["mobile", { width: 393, height: 852 }], ["desktop", { width: 1440, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  for (const p of pages) {
    await page.goto(`http://127.0.0.1:5602/admin${p ? "/" + p : ""}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${tag}-${p || "overview"}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) console.log("HORIZONTAL OVERFLOW", tag, p);
  }
  if (errs.length) console.log(tag, "console errors:", [...new Set(errs)].slice(0, 5));
}
await browser.close();

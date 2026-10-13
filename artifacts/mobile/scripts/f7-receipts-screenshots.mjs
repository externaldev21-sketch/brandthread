/**
 * F7 item 104: screenshots of the rendered buyer receipt email.
 *   1. cd artifacts/api-server && npx tsx scripts/render-sample-receipt.ts <dir>/after
 *      (and with a copy of dev's brandthreadEmail.ts for <dir>/before)
 *   2. node artifacts/mobile/scripts/f7-receipts-screenshots.mjs <dir> <outDir>
 * Shoots every <dir>/{before,after}/*.html at 393x852 (mobile mail) and
 * 600px (desktop mail), light, plus dark mode for the "after" receipt.
 * Sample https image URLs are served from local repo assets.
 */
import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) throw new Error("usage: f7-receipts-screenshots.mjs <inDir> <outDir>");
mkdirSync(outDir, { recursive: true });

const boots = readFileSync(path.resolve(here, "../assets/images/products/leather-ankle-boots.jpg"));
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="80" viewBox="0 0 340 80"><rect width="80" height="80" rx="16" fill="#111"/><text x="40" y="54" font-family="Helvetica,Arial" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">N</text><text x="98" y="52" font-family="Helvetica,Arial" font-size="30" font-weight="700" letter-spacing="2" fill="#111">NORTHBOUND</text></svg>`;

const browser = await chromium.launch();
const widths = [
  { name: "mobile", width: 393, height: 852 },
  { name: "desktop", width: 600, height: 900 },
];
for (const phase of ["before", "after"]) {
  const dir = path.join(inDir, phase);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(path.join(dir, file), "utf8");
    const schemes = phase === "after" && file.startsWith("receipt-store-name") ? ["light", "dark"] : ["light"];
    for (const vp of widths) {
      for (const colorScheme of schemes) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, colorScheme });
        const page = await context.newPage();
        await page.route("https://cdn.example.com/**", (route) => {
          const url = route.request().url();
          if (url.endsWith(".svg")) return route.fulfill({ contentType: "image/svg+xml", body: logoSvg });
          return route.fulfill({ contentType: "image/jpeg", body: boots });
        });
        await page.setContent(html, { waitUntil: "load" });
        const suffix = colorScheme === "dark" ? "-dark" : "";
        const out = path.join(outDir, `${phase}-${file.replace(/\.html$/, "")}-${vp.name}${suffix}.png`);
        await page.screenshot({ path: out, fullPage: true });
        console.log(out);
        await context.close();
      }
    }
  }
}
await browser.close();

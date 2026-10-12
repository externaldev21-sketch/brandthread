/**
 * Link-preview card for brandthread.app/@handle (og:image): 1200×630 PNG with
 * the store logo and name on the left and the first three product photos on
 * the right, in the store's own theme. Instagram, TikTok, iMessage and
 * WhatsApp all show this card when the link is pasted into a DM or a bio.
 */
import net from "node:net";
import sharp, { type OverlayOptions } from "sharp";
import { esc } from "./bioPage";
import type { StoreSiteTheme } from "./storeSiteDesign";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type StoreSiteOgInput = {
  handle: string;
  displayName: string;
  logoUrl: string | null;
  productImages: string[];
  theme: StoreSiteTheme;
  /** "brandthread.app/@handle" — printed under the name. */
  displayUrl: string;
};

/**
 * Only public https hosts: no IP literals, no localhost or internal names, so
 * a stored image URL can't make the server fetch something on its network.
 */
export function isFetchableImageUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host)) return false;
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  return true;
}

type Fetcher = (url: string) => Promise<Buffer | null>;

export const fetchImage: Fetcher = async (url) => {
  if (!isFetchableImageUrl(url)) return null;
  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(3500) });
    if (!res.ok || !/^image\//i.test(res.headers.get("content-type") ?? "")) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > MAX_IMAGE_BYTES ? null : buf;
  } catch {
    return null;
  }
};

/** Name split over at most two lines of ~16 characters, so it never overflows the left column. */
export function ogNameLines(name: string, perLine = 16): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= perLine || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const out = lines.slice(0, 2).map((l) => (l.length > perLine ? `${l.slice(0, perLine - 1)}…` : l));
  if (lines.length > 2) out[1] = `${out[1].replace(/…$/, "").slice(0, perLine - 1)}…`;
  return out;
}

async function cover(buf: Buffer, w: number, h: number, radius = 0, circle = false): Promise<Buffer | null> {
  try {
    const img = sharp(buf, { failOn: "none" }).rotate().resize(w, h, { fit: "cover" });
    const mask = circle
      ? `<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 2}"/></svg>`
      : radius ? `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" ry="${radius}"/></svg>` : null;
    const out = mask ? img.composite([{ input: Buffer.from(mask), blend: "dest-in" }]) : img;
    return await out.png().toBuffer();
  } catch {
    return null;
  }
}

export async function renderStoreSiteOg(input: StoreSiteOgInput, fetcher: Fetcher = fetchImage): Promise<Buffer> {
  const { theme } = input;
  const name = input.displayName.trim() || `@${input.handle}`;
  const [logoBuf, ...productBufs] = await Promise.all([
    input.logoUrl ? fetcher(input.logoUrl) : Promise.resolve(null),
    ...input.productImages.slice(0, 3).map((u) => fetcher(u)),
  ]);

  const layers: OverlayOptions[] = [];
  const pad = 72;
  const logoSize = 168;
  const logo = logoBuf ? await cover(logoBuf, logoSize, logoSize, 0, true) : null;
  if (logo) layers.push({ input: logo, left: pad, top: 120 });

  // Up to three 3:4 tiles on the right, bottom-aligned, newest first.
  const tiles = (await Promise.all(productBufs.filter((b): b is Buffer => !!b).map((b) => cover(b, 192, 256, 12))))
    .filter((b): b is Buffer => !!b);
  const tileGap = 16;
  const tilesLeft = OG_WIDTH - pad - (tiles.length * 192 + Math.max(0, tiles.length - 1) * tileGap);
  tiles.forEach((t, i) => layers.push({ input: t, left: tilesLeft + i * (192 + tileGap), top: Math.round((OG_HEIGHT - 256) / 2) }));

  const nameLines = ogNameLines(name, tiles.length ? 16 : 26);
  const textTop = 120 + logoSize + 76;
  const initial = esc((name.replace(/^@/, "")[0] ?? "B").toUpperCase());
  const fontStack = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', sans-serif";
  const textSvg = `<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
${logo ? "" : `<circle cx="${pad + logoSize / 2}" cy="${120 + logoSize / 2}" r="${logoSize / 2}" fill="${theme.line}"/><text x="${pad + logoSize / 2}" y="${120 + logoSize / 2 + 26}" text-anchor="middle" font-family="${fontStack}" font-size="72" font-weight="700" fill="${theme.fg}">${initial}</text>`}
${nameLines.map((l, i) => `<text x="${pad}" y="${textTop + i * 64}" font-family="${fontStack}" font-size="56" font-weight="700" fill="${theme.fg}">${esc(l)}</text>`).join("")}
<text x="${pad}" y="${textTop + nameLines.length * 64 + 8}" font-family="${fontStack}" font-size="30" fill="${theme.muted}">${esc(input.displayUrl)}</text>
</svg>`;
  layers.push({ input: Buffer.from(textSvg), left: 0, top: 0 });

  return sharp({ create: { width: OG_WIDTH, height: OG_HEIGHT, channels: 3, background: theme.bg } })
    .composite(layers)
    .png({ compressionLevel: 8 })
    .toBuffer();
}

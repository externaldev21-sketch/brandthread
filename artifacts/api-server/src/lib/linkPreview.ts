/**
 * Link previews for DMs (polish #163), like Instagram's link cards: title,
 * site and image for the first URL in a message.
 *
 * Fetching a user-supplied URL is an SSRF surface, so every hop:
 *   - is http(s) on the default port only, no credentials in the URL;
 *   - resolves DNS and refuses any private/loopback/link-local address, then
 *     pins the socket to that exact address (no DNS rebinding);
 *   - follows at most MAX_REDIRECTS redirects, re-checking each;
 *   - reads at most MAX_BYTES of text/html within TIMEOUT_MS.
 * Results (and failures) are cached in memory.
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { isPrivateAddress } from "./shopifyImport";

export type LinkPreview = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string;
};

const TIMEOUT_MS = 4000;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 60 * 60_000;
const NEGATIVE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;

/** Normalizes a URL we are willing to fetch, or null. Pure. */
export function safePreviewUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (net.isIP(host) && isPrivateAddress(host)) return null;
  url.hash = "";
  return url;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content\s*=\s*("([^"]*)"|'([^']*)')/i);
    const value = content?.[2] ?? content?.[3];
    if (value && value.trim()) return decodeEntities(value.trim());
  }
  return null;
}

/** Pulls Open Graph / Twitter / <title> fields out of an HTML head. Pure. */
export function parsePreview(html: string, pageUrl: URL): LinkPreview | null {
  const head = html.slice(0, MAX_BYTES);
  const title = metaContent(head, ["og:title", "twitter:title"])
    ?? (head.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] ? decodeEntities(head.match(/<title[^>]*>([^<]{1,300})<\/title>/i)![1].trim()) : null);
  if (!title) return null;
  const description = metaContent(head, ["og:description", "twitter:description", "description"]);
  let imageUrl: string | null = null;
  const rawImage = metaContent(head, ["og:image:secure_url", "og:image", "twitter:image"]);
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      // Only https images the app can load directly; never internal hosts.
      if (resolved.protocol === "https:" && safePreviewUrl(resolved.href)) imageUrl = resolved.href;
    } catch { /* ignore a malformed image URL */ }
  }
  const siteName = metaContent(head, ["og:site_name"]) ?? pageUrl.hostname.replace(/^www\./, "");
  return {
    url: pageUrl.href,
    title: title.slice(0, 200),
    description: description ? description.slice(0, 300) : null,
    imageUrl,
    siteName: siteName.slice(0, 80),
  };
}

type Hop = { status: number; location?: string; contentType: string; body: string };

type LookupCallback = (
  err: Error | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * A `lookup` for http(s).request that always answers with the pre-checked
 * address. Node's net layer (autoSelectFamily, on by default since Node 20)
 * calls lookup with `{ all: true }` and then expects an array of records;
 * answering with a bare address there fails every request with
 * "Invalid IP address: undefined".
 */
export function pinnedLookup(pinned: { address: string; family: number }) {
  return (_host: string, options: unknown, cb: LookupCallback): void => {
    if ((options as { all?: boolean } | null)?.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
    else cb(null, pinned.address, pinned.family);
  };
}

async function fetchPinned(url: URL): Promise<Hop> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const records = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateAddress(r.address))) throw new Error("private address");
  const pinned = records[0];
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9",
        "User-Agent": "Mozilla/5.0 (compatible; BrandthreadLinkPreview/1.0)",
      },
      timeout: TIMEOUT_MS,
      lookup: pinnedLookup(pinned),
    } as https.RequestOptions, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers["content-type"] ?? "");
      if (status >= 300 && status < 400) {
        res.resume();
        resolve({ status, location: res.headers.location, contentType, body: "" });
        return;
      }
      if (!/text\/html|application\/xhtml/i.test(contentType)) {
        res.destroy();
        resolve({ status, contentType, body: "" });
        return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        chunks.push(chunk);
        // The head (where the meta tags live) is all we need.
        if (size >= MAX_BYTES) res.destroy();
      });
      const done = () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") });
      res.on("end", done);
      res.on("close", done);
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

const cache = new Map<string, { at: number; value: LinkPreview | null }>();

export async function getLinkPreview(
  raw: string,
  fetcher: (url: URL) => Promise<Hop> = fetchPinned,
): Promise<LinkPreview | null> {
  const start = safePreviewUrl(raw);
  if (!start) return null;
  const key = start.href;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? CACHE_TTL_MS : NEGATIVE_TTL_MS)) return hit.value;

  let value: LinkPreview | null = null;
  try {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const res = await fetcher(url);
      if (res.status >= 300 && res.status < 400 && res.location) {
        const next = safePreviewUrl(new URL(res.location, url).href);
        if (!next) break;
        url = next;
        continue;
      }
      if (res.status >= 200 && res.status < 300 && res.body) value = parsePreview(res.body, url);
      break;
    }
  } catch {
    value = null;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Test hook. */
export function clearLinkPreviewCache(): void { cache.clear(); }

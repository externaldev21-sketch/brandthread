import crypto from "node:crypto";
import net from "node:net";
import { MAX_IMAGES_PER_PRODUCT } from "./types";

/** Lower-case, underscores/hyphens to spaces, collapsed whitespace. */
export function normalizeHeader(header: string): string {
  return header.replace(/^﻿/, "").toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Parses a price cell to integer cents. Accepts "12", "12.50", "$1,299.00",
 * "12,50" (comma decimal), "1.299,00", "USD 12.00". Returns null when it is
 * not a non-negative number.
 */
export function parsePriceToCents(value: unknown): number | null {
  let text = String(value ?? "").trim();
  if (!text) return null;
  text = text.replace(/[^\d.,\-]/g, "");
  if (!text || /^-/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = text.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    // "12,50" is a decimal; "1,299" / "1,299,000" are thousands.
    normalized = /,\d{1,2}$/.test(text) && text.indexOf(",") === lastComma
      ? text.replace(",", ".") : text.split(",").join("");
  } else {
    normalized = text;
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2)) + (Number(fraction[2] ?? 0) >= 5 ? 1 : 0);
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : null;
}

export function parseStock(value: unknown): { value: number; warning?: string } {
  const text = String(value ?? "").trim();
  if (!text) return { value: 0 };
  const n = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(n)) return { value: 0, warning: `Quantity "${text}" is not a number; set to 0.` };
  if (n < 0) return { value: 0, warning: `Quantity ${text} is negative; set to 0.` };
  return { value: Math.min(Math.floor(n), 1_000_000) };
}

export function slugify(value: string, max = 80): string {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max);
}

export function skuToken(value: string): string {
  return value.toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16);
}

export function stripHtml(html: string | null | undefined, max = 8000): string {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"').replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim().slice(0, max);
}

export function splitList(value: string, extraSeparators = ""): string[] {
  const re = new RegExp(`[,${extraSeparators.replace(/[\]\\^-]/g, "\\$&")}]`);
  return value.split(re).map((part) => part.trim()).filter(Boolean);
}

export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().slice(0, 50);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 30) break;
  }
  return out;
}

function isPrivateIp(address: string): boolean {
  const a = address.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateIp(mapped);
  if (net.isIPv4(a)) {
    const [p, q] = a.split(".").map(Number);
    return p === 10 || p === 127 || (p === 172 && q >= 16 && q <= 31) || (p === 100 && q >= 64 && q <= 127)
      || (p === 169 && q === 254) || (p === 192 && (q === 0 || q === 168)) || (p === 198 && (q === 18 || q === 19))
      || p === 0 || p >= 224;
  }
  if (net.isIPv6(a)) {
    const first = Number.parseInt(a.split(":")[0] || "0", 16);
    return first < 0x2000 || first > 0x3fff;
  }
  return false;
}

/**
 * Image URLs are stored as references only (exactly what the Shopify public
 * import does) — the server never fetches them, so there is no SSRF surface.
 * We still refuse URLs that could never be a public image so we do not store
 * references to internal hosts that a client or a later fetcher might follow.
 */
export function sanitizeImageUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  let url: URL;
  try { url = new URL(text.startsWith("//") ? `https:${text}` : text); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (net.isIP(host) && isPrivateIp(host)) return null;
  if (!net.isIP(host) && !host.includes(".")) return null;
  return url.toString();
}

export function sanitizeImages(urls: string[]): { images: string[]; rejected: number } {
  const images: string[] = [];
  let rejected = 0;
  for (const raw of urls) {
    const clean = sanitizeImageUrl(raw);
    if (!clean) { if (raw.trim()) rejected++; continue; }
    if (!images.includes(clean)) images.push(clean);
  }
  if (images.length > MAX_IMAGES_PER_PRODUCT) {
    rejected += images.length - MAX_IMAGES_PER_PRODUCT;
    images.length = MAX_IMAGES_PER_PRODUCT;
  }
  return { images, rejected };
}

export function sha(value: string, length = 16): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, length);
}

export type AxisKind = "size" | "color" | "other";
export function classifyAxis(label: string): AxisKind {
  const text = label.toLowerCase();
  if (/colou?r|shade|hue/.test(text)) return "color";
  if (/size|dimension|fit/.test(text)) return "size";
  return "other";
}

/**
 * Folds option axes into the two existing variant columns. Size/colour axes go
 * to `size`/`color`; every other axis is appended to `size` as "Name: value"
 * (same convention as the Shopify public-URL import) so two variants that
 * differ only in, say, material stay distinguishable without a new column.
 */
export function foldAxes(axes: Array<{ label: string; value: string }>): { size: string | null; color: string | null } {
  const present = axes.filter((axis) => axis.value.trim() && axis.value.trim().toLowerCase() !== "default title");
  const size = present.find((axis) => classifyAxis(axis.label) === "size")?.value.trim();
  const color = present.find((axis) => classifyAxis(axis.label) === "color")?.value.trim();
  const others = present
    .filter((axis) => classifyAxis(axis.label) === "other")
    .map((axis) => (axis.label.trim() ? `${axis.label.trim()}: ${axis.value.trim()}` : axis.value.trim()));
  // Second+ size-like or colour-like axes (e.g. "Secondary color") are "other".
  const extraSizeColor = present
    .filter((axis) => classifyAxis(axis.label) !== "other")
    .filter((axis) => axis.value.trim() !== size && axis.value.trim() !== color)
    .map((axis) => `${axis.label.trim()}: ${axis.value.trim()}`);
  const sizeText = [size, ...others, ...extraSizeColor].filter(Boolean).join(" / ");
  return { size: sizeText || null, color: color || null };
}

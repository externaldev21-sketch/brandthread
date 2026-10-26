/**
 * Store Settings → Status "Password protected": the published store website
 * is only shown after the visitor enters the store password.
 *
 * The seller sets the password with PUT /api/store/password (hashed, never
 * stored in plain text) and turns protection on with storeSettings
 * .passwordProtected. A visitor posts the password to the same store URL;
 * on a match the server sets an HttpOnly cookie for that store. The cookie is
 * an HMAC keyed by the current password hash, so changing or clearing the
 * password signs everyone out.
 */
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { verifyStorePassword } from "./storeSettingsSecurity";

type GatedStorefront = { id: string; title?: string | null; storePasswordHash?: string | null; storeSettings?: unknown };

const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600;

export function storePasswordRequired(sf: GatedStorefront): boolean {
  const settings = sf.storeSettings && typeof sf.storeSettings === "object" ? sf.storeSettings as Record<string, unknown> : {};
  return !!sf.storePasswordHash && settings.passwordProtected === true;
}

function cookieName(sf: GatedStorefront): string {
  return `bt_store_${sf.id.replace(/[^A-Za-z0-9]/g, "")}`;
}

function unlockValue(sf: GatedStorefront): string {
  return crypto.createHmac("sha256", String(sf.storePasswordHash)).update(`store-unlock:${sf.id}`).digest("base64url");
}

function readCookie(req: Request, name: string): string | null {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** True when this visitor still has to enter the store password. */
export function storeLockedFor(req: Request, sf: GatedStorefront): boolean {
  if (!storePasswordRequired(sf)) return false;
  const presented = readCookie(req, cookieName(sf)) ?? req.header("x-store-unlock") ?? null;
  return !presented || !safeEqual(presented, unlockValue(sf));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function storePasswordPage(sf: GatedStorefront, error?: string): string {
  const title = escapeHtml(sf.title || "This store");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="robots" content="noindex">
<title>${title}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{background:#000;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}
.card{width:100%;max-width:360px;text-align:center;}.title{font-size:1.4rem;font-weight:700;margin-bottom:8px;}.sub{color:#999;font-size:.9rem;line-height:1.6;margin-bottom:20px;}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #333;background:#111;color:#fff;font-size:1rem;margin-bottom:12px;}
button{width:100%;padding:12px;border-radius:10px;border:0;background:#fff;color:#000;font-weight:600;font-size:1rem;cursor:pointer;}.err{color:#ff6b6b;font-size:.85rem;margin-bottom:12px;}</style>
</head><body><form class="card" method="POST"><p class="title">${title}</p><p class="sub">This store is password protected. Enter the password to continue.</p>
${error ? `<p class="err" role="alert">${escapeHtml(error)}</p>` : ""}<input type="password" name="password" autocomplete="current-password" aria-label="Store password" required autofocus>
<button type="submit">Enter store</button></form></body></html>`;
}

/** Sends the password page (GET) instead of the store. */
export function sendStorePasswordPage(res: Response, sf: GatedStorefront, status = 401, error?: string): void {
  res.status(status).set("Cache-Control", "no-store").type("html").send(storePasswordPage(sf, error));
}

/**
 * POST to a store URL with { password }. On a match sets the unlock cookie
 * and redirects back to the same URL (GET); otherwise shows the page again.
 */
export async function handleStoreUnlock(req: Request, res: Response, sf: GatedStorefront): Promise<void> {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!storePasswordRequired(sf)) { res.redirect(303, req.originalUrl); return; }
  if (!password || !(await verifyStorePassword(password, sf.storePasswordHash))) {
    sendStorePasswordPage(res, sf, 401, "That password isn't right. Try again.");
    return;
  }
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${cookieName(sf)}=${encodeURIComponent(unlockValue(sf))}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`);
  res.redirect(303, req.originalUrl);
}

/** The value a client that unlocked the store sends as `x-store-unlock` (JSON API). */
export async function storeUnlockToken(sf: GatedStorefront, password: string): Promise<string | null> {
  return (await verifyStorePassword(password, sf.storePasswordHash)) ? unlockValue(sf) : null;
}

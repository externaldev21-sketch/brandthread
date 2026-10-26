/**
 * Settings functional sweep: every control on the buyer and seller Settings
 * screens that saves something, driven through the REAL Express app (the full
 * middleware stack in src/app.ts: Clerk, team context, role/plan gates,
 * validation) against a real Postgres database. Only the Clerk boundary is
 * mocked (x-test-user-id stands in for the session).
 *
 * For each control: send exactly the request the mobile screen sends, expect
 * 2xx, read the value back through the endpoint the screen loads from (the
 * "reload"), then put the original value back and read that back too.
 *
 * Rows are grouped by screen; `screen`/`control` match the PR's pass/fail
 * table. Set SETTINGS_SWEEP_REPORT=<file> to write that table as markdown.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, eq, sql } from "drizzle-orm";
import { db, forYouFeedCache, storefronts, users, userSettings } from "@workspace/db";

vi.mock("@clerk/express", () => ({
  getAuth: (req: any) => ({ userId: req.header?.("x-test-user-id") || null, sessionId: null }),
  clerkMiddleware: () => (_req: any, _res: any, next: () => void) => next(),
  clerkClient: {
    users: { getUser: async () => ({ emailAddresses: [], phoneNumbers: [] }), updateUserMetadata: async () => ({}) },
    sessions: { getSessionList: async () => ({ data: [], totalCount: 0 }) },
  },
}));
vi.mock("../notifications-feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications-feed")>()),
  publishNotification: async () => undefined,
}));

const RUN = `sweep${crypto.randomBytes(4).toString("hex")}`;
const BUYER = `${RUN}_buyer`;
const SELLER = `${RUN}_seller`;
/** A second buyer for the behaviour checks, so the sweep's own volume never trips its rate limits. */
const BUYER2 = `${RUN}_buyer2`;
const ALL = [BUYER, SELLER, BUYER2];

let server: Server;
let base = "";

type Res = { status: number; body: any };
async function call(user: string, method: string, path: string, body?: unknown): Promise<Res> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  return { status: response.status, body: parsed };
}

async function raw(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const response = await fetch(`${base}${path}`, { redirect: "manual", ...init });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

type Req = [method: string, path: string, body?: unknown];
interface Row {
  screen: string;
  control: string;
  as?: string;
  /** The write the screen sends. */
  write: Req;
  /** Where the screen reads the value back from on load. */
  read: string;
  /** True when the read-back shows the written value. */
  check: (body: any) => boolean;
  /** Puts the original value back (optional for create/delete style rows). */
  revert?: Req;
  /** True when the read-back shows the original value again. */
  checkRevert?: (body: any) => boolean;
}

const rows: Row[] = [
  // ── Buyer: Privacy ────────────────────────────────────────────────────────
  { screen: "Privacy", control: "Private account", write: ["PATCH", "/api/auth/privacy", { isPrivate: true }], read: "/api/auth/privacy",
    check: (b) => b.isPrivate === true, revert: ["PATCH", "/api/auth/privacy", { isPrivate: false }], checkRevert: (b) => b.isPrivate === false },
  ...([
    ["Follow you", "whoCanSendFriendRequests", "nobody", "everyone"],
    ["See your posts", "whoCanSeePosts", "friends", "everyone"],
    ["See who you follow", "whoCanSeeFriendsList", "only_me", "everyone"],
    ["Reply to stories", "whoCanReplyToStories", "nobody", "everyone"],
    ["Mention you", "whoCanMention", "friends", "everyone"],
    ["Appear in search", "searchable", false, true],
  ] as const).map(([control, key, next, prev]): Row => ({
    screen: "Privacy", control, write: ["PATCH", "/api/auth/privacy", { settings: { [key]: next } }], read: "/api/auth/privacy",
    check: (b) => b.settings?.[key] === next, revert: ["PATCH", "/api/auth/privacy", { settings: { [key]: prev } }], checkRevert: (b) => b.settings?.[key] === prev,
  })),
  { screen: "Privacy", control: "Activity status", write: ["PATCH", "/api/auth/privacy", { showActivityStatus: false }], read: "/api/auth/privacy",
    check: (b) => b.showActivityStatus === false, revert: ["PATCH", "/api/auth/privacy", { showActivityStatus: true }], checkRevert: (b) => b.showActivityStatus === true },
  { screen: "Privacy", control: "Read receipts", write: ["PATCH", "/api/auth/privacy", { readReceipts: false }], read: "/api/auth/privacy",
    check: (b) => b.readReceipts === false, revert: ["PATCH", "/api/auth/privacy", { readReceipts: true }], checkRevert: (b) => b.readReceipts === true },
  { screen: "Privacy", control: "Show your saves", write: ["PATCH", "/api/auth/privacy", { showSavesToFollowers: false }], read: "/api/auth/privacy",
    check: (b) => b.showSavesToFollowers === false, revert: ["PATCH", "/api/auth/privacy", { showSavesToFollowers: true }], checkRevert: (b) => b.showSavesToFollowers === true },
  { screen: "Privacy", control: "Who can message you", write: ["PATCH", "/api/auth/privacy", { dmPrivacy: "followers_only" }], read: "/api/auth/privacy",
    check: (b) => b.dmPrivacy === "followers_only", revert: ["PATCH", "/api/auth/privacy", { dmPrivacy: "requests" }], checkRevert: (b) => b.dmPrivacy === "requests" },

  // ── Buyer: Muted words / Hidden words ─────────────────────────────────────
  { screen: "Muted words", control: "Add / remove word", write: ["POST", "/api/safety/muted-words", { phrase: "sweepword" }], read: "/api/safety/muted-words",
    check: (b) => JSON.stringify(b).includes("sweepword"), revert: ["DELETE", "/api/safety/muted-words/sweepword"], checkRevert: (b) => !JSON.stringify(b).includes("sweepword") },
  { screen: "Hidden words", control: "Hide comments (custom)", write: ["PUT", "/api/safety/hidden-words", { hideCustom: true }], read: "/api/safety/hidden-words",
    check: (b) => JSON.stringify(b).includes('"hideCustom":true'), revert: ["PUT", "/api/safety/hidden-words", { hideCustom: false }], checkRevert: (b) => JSON.stringify(b).includes('"hideCustom":false') },
  { screen: "Hidden words", control: "Custom words", write: ["PUT", "/api/safety/hidden-words", { words: ["sweepcustom"] }], read: "/api/safety/hidden-words",
    check: (b) => JSON.stringify(b).includes("sweepcustom"), revert: ["PUT", "/api/safety/hidden-words", { words: [] }], checkRevert: (b) => !JSON.stringify(b).includes("sweepcustom") },

  // ── Buyer: Close friends ──────────────────────────────────────────────────
  { screen: "Close friends", control: "Save list", write: ["PUT", "/api/social/close-friends", { friendIds: [] }], read: "/api/social/close-friends",
    check: (b) => Array.isArray(b.friendIds) },

  // ── Buyer: Notifications ──────────────────────────────────────────────────
  { screen: "Notifications", control: "Pause all", write: ["PUT", "/api/notification-prefs", { pause: { minutes: 60 }, pushEnabled: true }], read: "/api/notification-prefs",
    check: (b) => !!b.pausedUntil, revert: ["PUT", "/api/notification-prefs", { pause: null, pushEnabled: true }], checkRevert: (b) => !b.pausedUntil },
  { screen: "Notifications", control: "Sleep mode", write: ["PUT", "/api/notification-prefs", { quietHours: { start: "22:00", end: "07:00", timezone: "UTC" } }], read: "/api/notification-prefs",
    check: (b) => b.quietHours?.start === "22:00", revert: ["PUT", "/api/notification-prefs", { quietHours: null }], checkRevert: (b) => b.quietHours?.start == null },
  ...(["likes", "comments", "mentions", "reposts", "new_followers", "accepted_follow_requests", "messages", "message_reactions", "calls", "missed_calls", "live", "order_updates", "shipped", "delivered", "returns_refunds"])
    .map((key): Row => ({
      screen: "Notifications", control: `Per-type: ${key}`, write: ["PUT", "/api/notification-prefs", { pushTypes: { [key]: "off" } }], read: "/api/notification-prefs",
      check: (b) => b.pushTypes?.[key] === "off", revert: ["PUT", "/api/notification-prefs", { pushTypes: { [key]: "everyone" } }], checkRevert: (b) => b.pushTypes?.[key] === "everyone",
    })),
  { screen: "Notifications", control: "Saved items alerts", write: ["PUT", "/api/notification-prefs", { categories: { saved_alerts: false } }], read: "/api/notification-prefs",
    check: (b) => b.categories?.saved_alerts === false, revert: ["PUT", "/api/notification-prefs", { categories: { saved_alerts: true } }], checkRevert: (b) => b.categories?.saved_alerts === true },
  { screen: "Notifications", control: "Login alerts", write: ["PUT", "/api/notification-prefs", { categories: { login_alerts: false } }], read: "/api/notification-prefs",
    check: (b) => b.categories?.login_alerts === false, revert: ["PUT", "/api/notification-prefs", { categories: { login_alerts: true } }], checkRevert: (b) => b.categories?.login_alerts === true },
  { screen: "Notifications", control: "Promotions and offers", write: ["PUT", "/api/notification-prefs", { promotionalPush: true }], read: "/api/notification-prefs",
    check: (b) => b.promotionalPush === true, revert: ["PUT", "/api/notification-prefs", { promotionalPush: false }], checkRevert: (b) => b.promotionalPush === false },
  { screen: "Email & in-app", control: "Email channel (order_updates)", write: ["PUT", "/api/notification-prefs", { channels: { email: { order_updates: false } } }], read: "/api/notification-prefs",
    check: (b) => b.channels?.email?.order_updates === false, revert: ["PUT", "/api/notification-prefs", { channels: { email: { order_updates: true } } }], checkRevert: (b) => b.channels?.email?.order_updates === true },
  { screen: "Email & in-app", control: "In-app channel (order_updates)", write: ["PUT", "/api/notification-prefs", { channels: { inApp: { order_updates: false } } }], read: "/api/notification-prefs",
    check: (b) => b.channels?.inApp?.order_updates === false, revert: ["PUT", "/api/notification-prefs", { channels: { inApp: { order_updates: true } } }], checkRevert: (b) => b.channels?.inApp?.order_updates === true },

  // ── Buyer: Appearance / accessibility / app ───────────────────────────────
  { screen: "Appearance", control: "Theme", write: ["PATCH", "/api/auth/profile", { appThemeId: "monochrome" }], read: "/api/auth/me",
    check: (b) => (b.appThemeId ?? b.user?.appThemeId) === "monochrome" },
  { screen: "Accessibility", control: "Text size", write: ["PATCH", "/api/display-preferences", { textSize: "large" }], read: "/api/display-preferences",
    check: (b) => JSON.stringify(b).includes('"textSize":"large"'), revert: ["PATCH", "/api/display-preferences", { textSize: "default" }], checkRevert: (b) => JSON.stringify(b).includes('"textSize":"default"') },
  { screen: "Accessibility", control: "High contrast icons", write: ["PATCH", "/api/display-preferences", { highContrastIcons: true }], read: "/api/display-preferences",
    check: (b) => JSON.stringify(b).includes('"highContrastIcons":true'), revert: ["PATCH", "/api/display-preferences", { highContrastIcons: false }], checkRevert: (b) => JSON.stringify(b).includes('"highContrastIcons":false') },
  ...(["reduceMotion", "captions", "loginAlerts", "personalizedRecommendations"] as const).map((key): Row => ({
    screen: key === "loginAlerts" ? "Password & security" : key === "personalizedRecommendations" ? "Shopping preferences" : "Accessibility",
    control: key, write: ["PATCH", "/api/me/settings", { [key]: false }], read: "/api/me/settings",
    check: (b) => b.settings?.[key] === false, revert: ["PATCH", "/api/me/settings", { [key]: true }], checkRevert: (b) => b.settings?.[key] === true,
  })),
  { screen: "Shopping preferences", control: "Preferred fit", write: ["PATCH", "/api/me/settings", { preferredFit: "oversized" }], read: "/api/me/settings",
    check: (b) => b.settings?.preferredFit === "oversized", revert: ["PATCH", "/api/me/settings", { preferredFit: "regular" }], checkRevert: (b) => b.settings?.preferredFit === "regular" },
  { screen: "Shopping preferences", control: "Style interests", write: ["PATCH", "/api/buyer/preferences", { styleInterests: ["streetwear"] }], read: "/api/buyer/preferences",
    check: (b) => JSON.stringify(b).includes("streetwear"), revert: ["PATCH", "/api/buyer/preferences", { styleInterests: [] }], checkRevert: (b) => !JSON.stringify(b).includes("streetwear") },
  { screen: "My sizes", control: "Size chips (tops)", write: ["PATCH", "/api/buyer/preferences", { sizes: { tops: "M" } }], read: "/api/buyer/preferences",
    check: (b) => JSON.stringify(b).includes('"tops":"M"'), revert: ["PATCH", "/api/buyer/preferences", { sizes: { tops: null } }], checkRevert: (b) => !JSON.stringify(b).includes('"tops":"M"') },
  { screen: "My sizes", control: "Measurements (height)", write: ["PATCH", "/api/buyer/preferences", { sizes: { measurements: { heightCm: 180 } } }], read: "/api/buyer/preferences",
    check: (b) => JSON.stringify(b).includes("180") },
  { screen: "My sizes", control: "Units (cm/in, kg/lb)", write: ["PATCH", "/api/buyer/preferences", { sizes: { units: { length: "in", weight: "lb" } } }], read: "/api/buyer/preferences",
    check: (b) => b.sizes?.units?.length === "in" && b.sizes?.units?.weight === "lb",
    revert: ["PATCH", "/api/buyer/preferences", { sizes: { units: { length: "cm", weight: "kg" } } }], checkRevert: (b) => b.sizes?.units?.length === "cm" },
  { screen: "Currency", control: "Display currency", write: ["PATCH", "/api/fx/display-currency", { displayCurrency: "EUR" }], read: "/api/fx/display-currency",
    check: (b) => JSON.stringify(b).includes("EUR"), revert: ["PATCH", "/api/fx/display-currency", { displayCurrency: "USD" }], checkRevert: (b) => JSON.stringify(b).includes("USD") },
  { screen: "AI data sharing", control: "Allow Brandthread AI", write: ["PUT", "/api/ai-consent", { granted: true }], read: "/api/ai-consent",
    check: (b) => JSON.stringify(b).includes("true"), revert: ["PUT", "/api/ai-consent", { granted: false }], checkRevert: (b) => JSON.stringify(b).includes("false") },
  { screen: "Tips", control: "Skip all tips", write: ["POST", "/api/first-run-tips/skip-all", { skipAll: true }], read: "/api/first-run-tips/seen",
    check: (b) => JSON.stringify(b).includes("true"), revert: ["POST", "/api/first-run-tips/skip-all", { skipAll: false }] },

  // ── Buyer: Personal details / addresses / account ─────────────────────────
  { screen: "Personal details", control: "Name / pronouns", write: ["PATCH", "/api/auth/profile", { name: "Sweep Buyer 2", pronouns: "they/them" }], read: "/api/auth/me",
    check: (b) => JSON.stringify(b).includes("Sweep Buyer 2") && JSON.stringify(b).includes("they/them"),
    revert: ["PATCH", "/api/auth/profile", { name: "Sweep Buyer", pronouns: null }], checkRevert: (b) => !JSON.stringify(b).includes("Sweep Buyer 2") },
  { screen: "Login activity", control: "Session list", write: ["GET", "/api/auth/sessions"], read: "/api/auth/sessions", check: () => true },
  { screen: "Account type", control: "Profiles", write: ["GET", "/api/accounts/profiles"], read: "/api/accounts/profiles", check: () => true },
  { screen: "Delete account", control: "Deletion check (stop at confirm)", write: ["GET", "/api/auth/account/deletion-check"], read: "/api/auth/account/deletion-check", check: () => true },
  { screen: "Download your data", control: "Request export", write: ["POST", "/api/auth/data-export", { include: ["profile"] }], read: "/api/auth/me", check: () => true },
  { screen: "Help & support", control: "Submit ticket", write: ["POST", "/api/support/tickets", { subject: "Sweep", body: "Settings sweep test ticket", category: "general", email: `${BUYER}@example.test`, name: "Sweep" }], read: "/api/auth/me", check: () => true },
  { screen: "Thread Cash", control: "Balance / history", write: ["GET", "/api/thread-cash"], read: "/api/thread-cash/history", check: () => true },
  { screen: "Rewards", control: "Loyalty", write: ["GET", "/api/loyalty"], read: "/api/loyalty", check: () => true },
  { screen: "Gift cards", control: "My cards", write: ["GET", "/api/gift-cards/mine"], read: "/api/gift-cards/mine", check: () => true },
  { screen: "Invite friends", control: "Invite code", write: ["GET", "/api/referrals/code"], read: "/api/referrals/stats", check: () => true },
  { screen: "Shipping addresses", control: "Add / delete address", write: ["POST", "/api/buyer/addresses", {
      label: "Home", recipientName: "Sweep Buyer", street: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "US", phone: "5125550100", isDefault: true,
    }], read: "/api/buyer/addresses", check: (b) => JSON.stringify(b).includes("1 Main St") },
  { screen: "Payment methods", control: "List cards", write: ["GET", "/api/buyer/payment-methods"], read: "/api/buyer/payment-methods", check: () => true },

  // ── Seller (store owner) ──────────────────────────────────────────────────
  { screen: "Seller settings", as: SELLER, control: "Account reach", write: ["PATCH", "/api/seller/settings", { accountScope: "us" }], read: "/api/seller/settings",
    check: (b) => JSON.stringify(b).includes('"accountScope":"us"'), revert: ["PATCH", "/api/seller/settings", { accountScope: "global" }], checkRevert: (b) => JSON.stringify(b).includes('"accountScope":"global"') },
  { screen: "Store languages", as: SELLER, control: "Store language", write: ["PATCH", "/api/seller/settings", { storeLanguage: "fr" }], read: "/api/seller/settings",
    check: (b) => JSON.stringify(b).includes('"storeLanguage":"fr"'), revert: ["PATCH", "/api/seller/settings", { storeLanguage: "en" }], checkRevert: (b) => JSON.stringify(b).includes('"storeLanguage":"en"') },
  { screen: "Customer privacy", as: SELLER, control: "Mask contact info", write: ["PATCH", "/api/seller/settings", { customerPrivacy: { maskContactInExports: true } }], read: "/api/seller/settings",
    check: (b) => JSON.stringify(b).includes("maskContactInExports") },
  { screen: "Store settings", as: SELLER, control: "Store name + settings", write: ["PUT", "/api/store", { title: "Sweep Store", storeSettings: { currency: "USD", language: "en", storeStatus: "published" } }], read: "/api/store",
    check: (b) => JSON.stringify(b).includes("Sweep Store") },
  { screen: "Store settings", as: SELLER, control: "Store URL", write: ["PUT", "/api/store/slug", { slug: `${RUN}-store2` }], read: "/api/store",
    check: (b) => JSON.stringify(b).includes(`${RUN}-store2`) },
  { screen: "Store settings", as: SELLER, control: "Rising brands opt-in", write: ["PUT", "/api/seller/profile/rising-brands", { optIn: false }], read: "/api/seller/profile",
    check: () => true },
  { screen: "Store policies", as: SELLER, control: "Return policy", write: ["PUT", "/api/seller/settings/policies", { policies: [{ type: "return", content: "30-day returns on unworn items." }] }], read: "/api/seller/settings/policies",
    check: (b) => JSON.stringify(b).includes("30-day returns") },
  { screen: "Store policies", as: SELLER, control: "Buyer cancel window", write: ["PUT", "/api/seller/cancel-window", { hours: 12 }], read: "/api/seller/cancel-window",
    check: (b) => b.hours === 12, revert: ["PUT", "/api/seller/cancel-window", { hours: null }], checkRevert: (b) => b.hours === null },
  { screen: "Shipping & fulfillment", as: SELLER, control: "Ship-from country", write: ["PATCH", "/api/shipping-zones/settings", { shipFromCountry: "CA" }], read: "/api/shipping-zones/settings",
    check: (b) => JSON.stringify(b).includes('"CA"'), revert: ["PATCH", "/api/shipping-zones/settings", { shipFromCountry: "US" }], checkRevert: (b) => JSON.stringify(b).includes('"US"') },
  { screen: "Taxes & duties", as: SELLER, control: "Charge tax on shipping", write: ["PATCH", "/api/taxes/config", { chargeShippingTax: true }], read: "/api/taxes/status",
    check: (b) => JSON.stringify(b).includes('"chargeShippingTax":true'), revert: ["PATCH", "/api/taxes/config", { chargeShippingTax: false }], checkRevert: (b) => JSON.stringify(b).includes('"chargeShippingTax":false') },
  { screen: "Payouts", as: SELLER, control: "Payout schedule (read)", write: ["GET", "/api/finance/payout-schedule"], read: "/api/finance/payout-schedule", check: () => true },
  { screen: "Billing / Subscription", as: SELLER, control: "Plan status", write: ["GET", "/api/seller/subscription/status"], read: "/api/seller/subscription/status", check: () => true },
  { screen: "Team", as: SELLER, control: "Members", write: ["GET", "/api/team/members"], read: "/api/team/members", check: () => true },
  { screen: "Discounts", as: SELLER, control: "Create code", write: ["POST", "/api/discount-codes", { code: `SW${RUN.slice(-6).toUpperCase()}`, type: "percentage", value: 10, minOrderCents: 0, appliesTo: "all", productIds: [], collectionIds: [], minQuantity: 0 }], read: "/api/discount-codes",
    check: (b) => JSON.stringify(b).includes(`SW${RUN.slice(-6).toUpperCase()}`) },
  { screen: "Gift cards (seller)", as: SELLER, control: "Enable + amounts", write: ["PUT", "/api/gift-cards/seller/settings", { enabled: true, denominations: [2500, 5000], allowCustom: false }], read: "/api/gift-cards/seller/settings",
    check: (b) => JSON.stringify(b).includes("2500") },
  { screen: "Vacation mode", as: SELLER, control: "Vacation toggle", write: ["PUT", "/api/seller/vacation", { vacationMode: true, vacationMessage: "Back soon" }], read: "/api/seller/vacation",
    check: (b) => JSON.stringify(b).includes("Back soon"), revert: ["PUT", "/api/seller/vacation", { vacationMode: false, vacationMessage: "" }], checkRevert: (b) => JSON.stringify(b).includes("false") },
  { screen: "Away message", as: SELLER, control: "Auto-reply", write: ["PUT", "/api/seller/away-message", { enabled: true, message: "Away right now", mode: "always" }], read: "/api/seller/away-message",
    check: (b) => JSON.stringify(b).includes("Away right now") },
  { screen: "Seller notifications", as: SELLER, control: "New order sound", write: ["PUT", "/api/notification-prefs", { categories: { new_order_sound: false } }], read: "/api/notification-prefs",
    check: (b) => b.categories?.new_order_sound === false, revert: ["PUT", "/api/notification-prefs", { categories: { new_order_sound: true } }], checkRevert: (b) => b.categories?.new_order_sound === true },
  { screen: "Seller notifications", as: SELLER, control: "Per-type: new_orders", write: ["PUT", "/api/notification-prefs", { pushTypes: { new_orders: "off" } }], read: "/api/notification-prefs",
    check: (b) => b.pushTypes?.new_orders === "off", revert: ["PUT", "/api/notification-prefs", { pushTypes: { new_orders: "everyone" } }], checkRevert: (b) => b.pushTypes?.new_orders === "everyone" },
  { screen: "Email marketing settings", as: SELLER, control: "Sender details", write: ["PUT", "/api/marketing/email/settings", { fromName: "Sweep Store", replyTo: `${SELLER}@example.test`, postalAddress: "1 Main St, Austin TX", doubleOptIn: false }], read: "/api/marketing/email/settings",
    check: (b) => JSON.stringify(b).includes("Sweep Store") },
  { screen: "Store pixels", as: SELLER, control: "Meta pixel", write: ["PUT", "/api/growth/pixels", { metaPixelId: "123456789012345", tiktokPixelId: null }], read: "/api/growth/pixels",
    check: (b) => JSON.stringify(b).includes("123456789012345") },
  { screen: "Export data", as: SELLER, control: "Export", write: ["POST", "/api/seller/export", { format: "csv", include: ["products"] }], read: "/api/seller/settings", check: () => true },
  { screen: "Integrations", as: SELLER, control: "Integrations list", write: ["GET", "/api/seller/settings/integrations"], read: "/api/seller/settings/integrations", check: () => true },
  { screen: "Edit profile", as: SELLER, control: "Website without https://", write: ["PATCH", "/api/auth/profile", { website: "https://sweepbrand.example" }], read: "/api/auth/me",
    check: (b) => JSON.stringify(b).includes("sweepbrand.example") },
  { screen: "Edit profile", as: SELLER, control: "Social links keep other platforms", write: ["PATCH", "/api/auth/profile", { socialLinks: { instagram: "sweepig" } }], read: "/api/auth/me",
    check: (b) => JSON.stringify(b).includes("sweepig") },
];

const results: Array<{ screen: string; control: string; ok: boolean; detail: string }> = [];

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: BUYER, email: `${BUYER}@example.test`, name: "Sweep Buyer", username: BUYER, accountType: "buyer", onboardingComplete: true },
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Sweep Seller", username: SELLER, accountType: "seller", onboardingComplete: true, brandName: "Sweep Store" },
    { clerkId: BUYER2, email: `${BUYER2}@example.test`, name: "Sweep Buyer Two", username: BUYER2, accountType: "buyer", onboardingComplete: true },
  ] as any);
  await db.insert(storefronts).values({ ownerId: SELLER, slug: `${RUN}-store`, title: "Sweep Store" } as any);
  const { default: app } = await import("../../app");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  const report = process.env.SETTINGS_SWEEP_REPORT;
  if (report) {
    fs.writeFileSync(report, ["| Screen | Control | Result | Detail |", "|---|---|---|---|",
      ...results.map((r) => `| ${r.screen} | ${r.control} | ${r.ok ? "PASS" : "FAIL"} | ${r.detail.replace(/\|/g, "/").slice(0, 160)} |`)].join("\n") + "\n");
  }
  await db.delete(storefronts).where(eq(storefronts.ownerId, SELLER));
  await db.delete(forYouFeedCache).where(inArray(forYouFeedCache.userId, ALL));
  await db.execute(sql`DELETE FROM seller_tax_config WHERE seller_id IN (${sql.join(ALL.map((id) => sql`${id}`), sql`, `)})`);
  for (const table of ["support_tickets"]) await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE clerk_id IN (${sql.join(ALL.map((id) => sql`${id}`), sql`, `)})`);
  for (const table of ["seller_settings", "seller_integrations"]) await db.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE owner_id IN (${sql.join(ALL.map((id) => sql`${id}`), sql`, `)})`);
  await db.delete(userSettings).where(inArray(userSettings.userId, ALL));
  await db.delete(users).where(inArray(users.clerkId, ALL));
});

describe("settings sweep: write → reload → revert", () => {
  for (const row of rows) {
    it(`${row.screen} › ${row.control}`, async () => {
      const as = row.as ?? BUYER;
      let detail = "";
      let ok = false;
      try {
        const w = await call(as, ...(row.write as [string, string, unknown?]));
        detail = `${row.write[0]} ${row.write[1]} → ${w.status}`;
        if (w.status >= 200 && w.status < 300) {
          const r = await call(as, "GET", row.read);
          ok = r.status === 200 && row.check(r.body);
          if (!ok) detail += `; reload ${r.status} did not show the value: ${JSON.stringify(r.body).slice(0, 120)}`;
          if (ok && row.revert) {
            const rv = await call(as, ...(row.revert as [string, string, unknown?]));
            const r2 = await call(as, "GET", row.read);
            ok = rv.status >= 200 && rv.status < 300 && (!row.checkRevert || row.checkRevert(r2.body));
            if (!ok) detail += `; revert ${rv.status} did not restore`;
          }
        } else {
          detail += ` ${JSON.stringify(w.body).slice(0, 140)}`;
        }
      } finally {
        results.push({ screen: row.screen, control: row.control, ok, detail });
      }
      expect(ok, detail).toBe(true);
    });
  }
});

/**
 * Settings whose promise is a behaviour somewhere else (checkout, the public
 * store, notifications, For You). Each test flips the control the way its
 * screen does and checks the behaviour itself, then puts it back.
 */
describe("settings sweep: the control changes what it promises", () => {
  async function behaviour(screen: string, control: string, run: () => Promise<void>) {
    let ok = false; let detail = "behaviour verified";
    try { await run(); ok = true; } catch (err) { detail = String((err as Error)?.message ?? err).split("\n")[0]; throw err; }
    finally { results.push({ screen, control, ok, detail }); }
  }
  const storeSlug = `${RUN}-store2`;
  const saveStore = (storeSettings: Record<string, unknown>) => call(SELLER, "PUT", "/api/store", { storeSettings });

  it("Privacy › many saves in one session never hit the credential rate limit", () => behaviour("Privacy", "Private account (after a normal session)", async () => {
    for (let i = 0; i < 40; i++) {
      const r = await call(BUYER2, i % 2 ? "GET" : "PATCH", "/api/auth/privacy", i % 2 ? undefined : { isPrivate: i % 4 === 0 });
      expect(r.status, `request ${i + 1}`).toBeLessThan(300);
    }
    expect((await call(BUYER2, "PATCH", "/api/auth/privacy", { isPrivate: false })).status).toBe(200);
  }));

  it("Store settings › status chips publish and unpublish the store", () => behaviour("Store settings", "Status chips", async () => {
    expect((await saveStore({ storeStatus: "published" })).status).toBe(200);
    expect((await raw(`/api/store/public/${storeSlug}`)).status).toBe(200);
    expect((await saveStore({ storeStatus: "unpublished" })).status).toBe(200);
    expect((await raw(`/api/store/public/${storeSlug}`)).status).toBe(404);
    expect((await call(SELLER, "GET", "/api/store")).body.storeSettings.storeStatus).toBe("unpublished");
    await saveStore({ storeStatus: "published" });
  }));

  it("Store settings › password protected locks the store until the password is entered", () => behaviour("Store settings", "Password protected + store password", async () => {
    expect((await call(SELLER, "PUT", "/api/store/password", { password: "letmein1" })).status).toBe(200);
    expect((await saveStore({ storeStatus: "password_protected", passwordProtected: true })).status).toBe(200);
    const locked = await raw(`/api/store/public/${storeSlug}`);
    expect(locked.status).toBe(403);
    expect(locked.text).toContain("STORE_PASSWORD_REQUIRED");
    const page = await raw(`/api/store/site/${storeSlug}`);
    expect(page.status).toBe(401);
    expect(page.text).toContain("password protected");
    const wrong = await raw(`/api/store/site/${storeSlug}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "password=nope" });
    expect(wrong.status).toBe(401);
    const right = await raw(`/api/store/site/${storeSlug}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "password=letmein1" });
    expect(right.status, right.text.slice(0, 300)).toBe(303);
    const cookie = (right.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toMatch(/^bt_store_/);
    const unlocked = await raw(`/api/store/site/${storeSlug}`, { headers: { cookie } });
    expect(unlocked.status).toBe(200);
    expect(unlocked.text).not.toContain("This store is password protected");
    const token = await call(BUYER2, "POST", `/api/store/public/${storeSlug}/unlock`, { password: "letmein1" });
    expect(token.status).toBe(200);
    expect((await raw(`/api/store/public/${storeSlug}`, { headers: { "x-store-unlock": token.body.unlockToken } })).status).toBe(200);
    // Clearing the password re-opens the store (and signs out old unlocks).
    await call(SELLER, "PUT", "/api/store/password", { password: null });
    await saveStore({ storeStatus: "published", passwordProtected: false });
    expect((await raw(`/api/store/public/${storeSlug}`)).status).toBe(200);
  }));

  it("Store settings › language, checkout switches and order alerts write through", () => behaviour("Store settings", "Language / Require account / Guest checkout / Order notifications", async () => {
    expect((await saveStore({ language: "fr", checkoutRequireAccount: true, checkoutGuestAllowed: false, orderNotifications: false })).status).toBe(200);
    const seller = (await call(SELLER, "GET", "/api/seller/settings")).body.settings;
    expect(seller.storeLanguage).toBe("fr");
    expect(seller.checkoutMode).toBe("accounts_required");
    expect((await call(SELLER, "GET", "/api/notification-prefs")).body.categories.new_orders).toBe(false);
    const view = (await call(SELLER, "GET", "/api/store")).body.storeSettings;
    expect(view).toMatchObject({ language: "fr", checkoutRequireAccount: true, checkoutGuestAllowed: false, orderNotifications: false });
    await saveStore({ language: "en", checkoutRequireAccount: false, checkoutGuestAllowed: true, orderNotifications: true });
    expect((await call(SELLER, "GET", "/api/seller/settings")).body.settings.checkoutMode).toBe("accounts_optional");
    expect((await call(SELLER, "GET", "/api/notification-prefs")).body.categories.new_orders).toBe(true);
  }));

  it("Store settings › Analytics off keeps tracking scripts off the store page", () => behaviour("Store settings", "Analytics", async () => {
    expect((await raw(`/api/store/site/${storeSlug}`)).text).toContain("bt_lc");
    await saveStore({ analyticsEnabled: false });
    expect((await raw(`/api/store/site/${storeSlug}`)).text).not.toContain("bt_lc");
    await saveStore({ analyticsEnabled: true });
  }));

  it("Store policies › the return policy reaches buyers' product pages", () => behaviour("Store policies", "Return policy shown to buyers", async () => {
    await call(SELLER, "PUT", "/api/seller/settings/policies", { policies: [{ type: "return", content: "Returns within 14 days." }] });
    const [row] = await db.select({ returnPolicy: users.returnPolicy }).from(users).where(eq(users.clerkId, SELLER)).limit(1);
    expect(row.returnPolicy).toBe("Returns within 14 days.");
  }));

  it("Seller settings › Account reach US-only refuses non-US destinations", () => behaviour("Seller settings", "Account reach enforced", async () => {
    await call(SELLER, "PATCH", "/api/seller/settings", { accountScope: "us" });
    expect((await raw(`/api/shipping-zones/resolve?sellerId=${SELLER}&country=CA`)).text).toContain('"unavailable":true');
    expect((await raw(`/api/shipping-zones/resolve?sellerId=${SELLER}&country=US`)).text).toContain('"unavailable":false');
    expect((await call(SELLER, "PATCH", "/api/seller/settings", { accountScope: "mars" })).status).toBe(400);
    await call(SELLER, "PATCH", "/api/seller/settings", { accountScope: "global" });
    expect((await raw(`/api/shipping-zones/resolve?sellerId=${SELLER}&country=CA`)).text).toContain('"unavailable":false');
  }));

  it("Taxes & duties › tax stays on unless the seller explicitly turns it off", () => behaviour("Taxes & duties", "Automatic tax / Charge tax on shipping", async () => {
    const { loadSellerTaxSwitches } = await import("../../lib/sellerTaxSwitches");
    // A seller who never opened the screen: both on, at checkout and on the screen.
    expect(await loadSellerTaxSwitches(BUYER2)).toEqual({ automaticTax: true, shippingTax: true });
    await db.execute(sql`DELETE FROM seller_tax_config WHERE seller_id = ${SELLER}`);
    const fresh = (await call(SELLER, "GET", "/api/taxes/status")).body;
    expect(fresh).toMatchObject({ stripeTaxEnabled: true, chargeShippingTax: true, automaticTaxAtCheckout: true });
    // Opening the screen (which creates the config row) changes nothing.
    expect(await loadSellerTaxSwitches(SELLER)).toEqual({ automaticTax: true, shippingTax: true });
    // Explicit switch-offs are honoured at checkout and shown on the screen.
    expect((await call(SELLER, "PATCH", "/api/taxes/config", { chargeShippingTax: false })).body.chargeShippingTax).toBe(false);
    expect(await loadSellerTaxSwitches(SELLER)).toEqual({ automaticTax: true, shippingTax: false });
    expect((await call(SELLER, "PATCH", "/api/taxes/config", { stripeTaxEnabled: false })).status).toBe(200);
    expect(await loadSellerTaxSwitches(SELLER)).toEqual({ automaticTax: false, shippingTax: false });
    expect((await call(SELLER, "GET", "/api/taxes/status")).body).toMatchObject({ stripeTaxEnabled: false, chargeShippingTax: false, automaticTaxAtCheckout: false });
    // Switching back on clears the opt-outs.
    await call(SELLER, "PATCH", "/api/taxes/config", { stripeTaxEnabled: true, chargeShippingTax: true });
    expect(await loadSellerTaxSwitches(SELLER)).toEqual({ automaticTax: true, shippingTax: true });
  }));

  it("Shopping preferences › turning off personalization drops the cached For You ranking", () => behaviour("Shopping preferences", "Personalized recommendations", async () => {
    await db.insert(forYouFeedCache).values({ userId: BUYER2, results: [{ id: "x" }], itemCount: 1 }).onConflictDoNothing();
    expect((await call(BUYER2, "PATCH", "/api/me/settings", { personalizedRecommendations: false })).status).toBe(200);
    expect(await db.select().from(forYouFeedCache).where(eq(forYouFeedCache.userId, BUYER2))).toHaveLength(0);
    await call(BUYER2, "PATCH", "/api/me/settings", { personalizedRecommendations: true });
  }));

  it("Report a problem › one ticket, with uploaded photos and device details", () => behaviour("Report a problem", "Send report (photos + diagnostics)", async () => {
    const own = `/objects/returns/${BUYER2}/photo-1`;
    const r = await call(BUYER2, "POST", "/api/support/problem-reports", {
      clientReportId: `${RUN}r1`, type: "other", description: "Sweep report", evidenceUrls: [own], contactedSeller: false,
      diagnostics: { appVersion: "1.0.0", platform: "ios" },
    });
    expect(r.status).toBe(201);
    const tickets = (await call(BUYER2, "GET", "/api/support/tickets")).body as Array<{ body: string; category: string }>;
    const mine = tickets.filter((t) => t.body.includes(`[ref:${RUN}r1]`));
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toContain(own);
    const foreign = await call(BUYER2, "POST", "/api/support/problem-reports", {
      clientReportId: `${RUN}r2`, type: "other", description: "x", evidenceUrls: ["/objects/returns/someone_else/p"],
    });
    expect(foreign.status).toBe(400);
  }));
});


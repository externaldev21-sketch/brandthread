/**
 * Brandthread assistant — the "brain" behind the pinned Brandthread chat in
 * every inbox. The account, the welcome thread and the chat route already
 * exist (lib/brandthreadAgent.ts, routes/brandthread-agent.ts); this module
 * adds what that chat needs to behave like a real app guide:
 *
 *   - availability: env keys (same check as every other AI feature,
 *     lib/aiHelpers/provider.ts) AND the `brandthreadAssistantChat` feature
 *     flag (migration 330), cached like lib/captions.ts does for its flag.
 *   - the system prompt: buyers get an app guide; sellers reuse the exact
 *     Brandthread AI (/ai-brain) prompt + verified seller snapshot from
 *     routes/ai.ts, plus the inbox rules below.
 *   - deep links: the model may end a reply with one `[[open:<id>]]` token;
 *     only ids in ASSISTANT_LINKS (routes verified to exist in the app) are
 *     turned into a tappable card. Anything else is stripped.
 *   - ensureAgentWelcome(): creates the welcome thread on first inbox open
 *     for accounts that never went through the onboarding hook.
 *
 * Same money rule as brandthreadAgent.ts: nothing here may import or call
 * Thread Cash / Stripe / checkout code (see brandthread-agent-no-money.test.ts).
 */
import { eq } from "drizzle-orm";
import { db, pool, users } from "@workspace/db";
import { aiConfigured } from "./aiHelpers/provider";
import { helpDocsForPrompt } from "./aiHelpDocs";
import { createWelcomeConversationOnce } from "./brandthreadAgent";
import { logger } from "./logger";

export type AssistantAccountType = "buyer" | "seller";

// ─── Availability ──────────────────────────────────────────────────────────

export const ASSISTANT_FLAG_KEY = "brandthreadAssistantChat";
const FLAG_CACHE_MS = 30_000;
let flagCache: { value: boolean; at: number } | null = null;

export function resetAssistantFlagCache(): void {
  flagCache = null;
}

async function assistantFlagEnabled(): Promise<boolean> {
  if (flagCache && Date.now() - flagCache.at < FLAG_CACHE_MS) return flagCache.value;
  let value = false;
  try {
    const result = await pool.query<{ enabled: boolean }>(
      "SELECT enabled FROM feature_flags WHERE key = $1 LIMIT 1",
      [ASSISTANT_FLAG_KEY],
    );
    value = result.rows[0]?.enabled === true;
  } catch (err) {
    logger.warn({ err }, "Could not read brandthreadAssistantChat flag; treating as off");
  }
  flagCache = { value, at: Date.now() };
  return value;
}

/** True only when the AI env keys exist AND the flag is on. Never throws. */
export async function assistantAvailable(): Promise<boolean> {
  if (!aiConfigured()) return false;
  return assistantFlagEnabled();
}

/** Persisted as the assistant's reply when it can't answer — never a fake answer. */
export const ASSISTANT_OFFLINE_REPLY =
  "The Brandthread assistant is offline right now. Your message is saved, so try again a little later.";
export const ASSISTANT_UNREACHABLE_REPLY =
  "I couldn't reach the assistant just now. Please try again in a moment.";

// ─── Deep links ────────────────────────────────────────────────────────────

export interface AssistantLink {
  label: string;
  route: string;
  roles: AssistantAccountType[];
  /** One line telling the model when this link fits. */
  when: string;
}

/** Every route here exists under artifacts/mobile/app. Keep it that way. */
export const ASSISTANT_LINKS: Record<string, AssistantLink> = {
  discover:        { label: "Open Discover",          route: "/(buyer)/discover",            roles: ["buyer"],           when: "finding brands, drops or new styles" },
  saved:           { label: "Open Saved",             route: "/buyer-saved",                 roles: ["buyer"],           when: "saves and collections" },
  buyer_orders:    { label: "Open Orders",            route: "/(buyer)/orders",              roles: ["buyer"],           when: "tracking or problems with an order they placed" },
  buyer_post:      { label: "Create a post",          route: "/create-post?accountType=buyer", roles: ["buyer"],         when: "how to post" },
  live:            { label: "Watch LIVE",             route: "/live-feed",                   roles: ["buyer"],           when: "watching LIVE shopping" },
  thread_cash:     { label: "Open Thread Cash",       route: "/thread-cash",                 roles: ["buyer"],           when: "Thread Cash" },
  store_builder:   { label: "Open Store Builder",     route: "/store-builder",               roles: ["seller"],          when: "setting up or editing their store" },
  add_product:     { label: "Add a product",          route: "/add-product",                 roles: ["seller"],          when: "listing or posting a product" },
  seller_post:     { label: "Create a post",          route: "/create-post",                 roles: ["seller"],          when: "posting content to the feed" },
  go_live:         { label: "Go LIVE",                route: "/seller-go-live",              roles: ["seller"],          when: "selling LIVE" },
  seller_orders:   { label: "Open Orders",            route: "/(tabs)/orders",               roles: ["seller"],          when: "orders to fulfil" },
  payouts:         { label: "Open Payouts",           route: "/finance",                     roles: ["seller"],          when: "payouts and getting paid" },
  manufacturers:   { label: "Open Manufacturer Hub",  route: "/manufacturer-hub",            roles: ["seller"],          when: "finding a manufacturer or production" },
  brandthread_ai:  { label: "Open Brandthread AI",    route: "/ai-brain",                    roles: ["seller"],          when: "deeper questions about their own store numbers" },
};

const LINK_TOKEN = /\[\[open:([a-z_]+)\]\]/gi;
const ACTION_BLOCK = /```json:action\n[\s\S]*?\n```/g;

export interface ParsedAssistantReply {
  text: string;
  link?: { id: string; label: string; route: string };
}

/** Strips link tokens (and the /ai-brain action-card blocks, which this chat
 *  doesn't render) and keeps the first allowlisted link for this role. */
export function parseAssistantReply(raw: string, accountType: AssistantAccountType): ParsedAssistantReply {
  let link: ParsedAssistantReply["link"];
  for (const match of raw.matchAll(LINK_TOKEN)) {
    const id = match[1].toLowerCase();
    const entry = ASSISTANT_LINKS[id];
    if (!link && entry && entry.roles.includes(accountType)) {
      link = { id, label: entry.label, route: entry.route };
    }
  }
  const text = raw.replace(ACTION_BLOCK, "").replace(LINK_TOKEN, "").replace(/[ \t]+\n/g, "\n").trim();
  return { text, link };
}

/** A tappable deep-link card (mobile renders `agent_card` with meta.deepLink). */
export function composeLinkCard(link: { label: string; route: string }) {
  return { type: "agent_card" as const, title: link.label, meta: { cardKind: "link", deepLink: link.route } };
}

// ─── System prompt ─────────────────────────────────────────────────────────

function linksForPrompt(accountType: AssistantAccountType): string {
  return Object.entries(ASSISTANT_LINKS)
    .filter(([, l]) => l.roles.includes(accountType))
    .map(([id, l]) => `- [[open:${id}]] — ${l.when}`)
    .join("\n");
}

const INBOX_RULES = [
  "## How to reply in this chat",
  "- You are chatting inside the user's Messages inbox as the account \"Brandthread\". You are openly an AI built by Brandthread; never claim to be human.",
  "- Keep replies short: 1-4 sentences, plain text, no headings, no emoji.",
  "- Only describe features listed in this prompt. If something isn't listed, say you're not sure it exists rather than guessing.",
  "- Never promise refunds, discount codes, payouts or account changes, and never move, grant or check Thread Cash or money.",
  "- When one screen would help, end the reply with exactly one link token from the list below (nothing else in brackets).",
].join("\n");

export const BUYER_APP_GUIDE = [
  "You are Brandthread, the assistant built into the Brandthread app: a social marketplace where independent fashion brands post, drop and sell.",
  "This user is a buyer. Help them find their way around the app.",
  "",
  "## What exists in the app (buyer side)",
  "- Home (Threads): a feed of posts, drops and campaigns from brands, with Following and Threads tabs. Double-tap to like; tap the bookmark to save.",
  "- Products are tagged in posts: tap one to see details, add to cart and check out without leaving the feed.",
  "- Discover tab: browse brands, drops and trending pieces to follow and shop.",
  "- Saved: everything they bookmark, organised into collections they create.",
  "- LIVE: brands sell live; the TV icon at the top of Home opens LIVE.",
  "- Posting: tap the + on their profile photo (Profile tab) to open the camera, then choose Post or Story.",
  "- Messages: DM brands and friends; message requests from people they don't follow land in Requests.",
  "- Orders: from Profile; buyers can report a problem with an order from the order itself.",
  "- Thread Cash: earned by checking in daily; can be applied as a discount at checkout (the card covers the rest), only sent to mutual follows, and can't be cashed out.",
].join("\n");

const SELLER_INBOX_ADDENDUM = [
  "## Seller app basics (for how-to questions)",
  "- Store Builder: set up and publish the storefront (name, sections, theme).",
  "- Products: add a product with photos, variants and price; it can also be posted to the feed.",
  "- LIVE: Go LIVE to sell in real time.",
  "- Orders tab: fulfil orders. Payouts run through Stripe once orders ship (see Payouts).",
  "- Manufacturer Hub: find manufacturers, request quotes and samples.",
  "- For deep questions about their own numbers, they can also open Brandthread AI.",
].join("\n");

export interface InboxPromptDeps {
  /** Lazily loads the /ai-brain prompt builder + seller snapshot (routes/ai.ts
   *  imports the OpenAI client eagerly, so it's only imported when online). */
  sellerPrompt?: (userId: string) => Promise<string>;
}

async function defaultSellerPrompt(userId: string): Promise<string> {
  const [{ buildSystemPrompt }, { buildSellerSnapshot }, { loadAiSettingsForEnforcement }] = await Promise.all([
    import("../routes/ai"),
    import("./sellerSnapshot"),
    import("./aiSettingsStore"),
  ]);
  const [snapshot, settings] = await Promise.all([
    buildSellerSnapshot(userId),
    loadAiSettingsForEnforcement(userId),
  ]);
  return buildSystemPrompt(snapshot, { screen: "inbox" }, undefined, settings);
}

export async function buildInboxAssistantPrompt(
  userId: string,
  accountType: AssistantAccountType,
  deps: InboxPromptDeps = {},
): Promise<string> {
  let base: string;
  if (accountType === "seller") {
    try {
      base = await (deps.sellerPrompt ?? defaultSellerPrompt)(userId);
    } catch (err) {
      // Snapshot failure must not take the chat down — fall back to the
      // feature reference only (no account data, so nothing to misstate).
      logger.warn({ err }, "Brandthread assistant: seller snapshot unavailable");
      base = [
        "You are Brandthread AI, the assistant built into the Brandthread seller platform.",
        "Account data is unavailable right now; answer how-to questions only and say so if asked about numbers.",
        "",
        "How Brandthread features work:",
        helpDocsForPrompt(),
      ].join("\n");
    }
    base = `${base}\n\n${SELLER_INBOX_ADDENDUM}`;
  } else {
    base = BUYER_APP_GUIDE;
  }
  return [base, "", INBOX_RULES, linksForPrompt(accountType)].join("\n");
}

// ─── Ensure the welcome thread exists ──────────────────────────────────────

/** Users already confirmed to have their welcome thread in this process. */
const ensured = new Set<string>();

export function resetEnsuredWelcomeCache(): void {
  ensured.clear();
}

/**
 * Creates the Brandthread welcome thread on first inbox open for any
 * onboarded buyer/seller who doesn't have one (createWelcomeConversationOnce
 * is idempotent and race-safe on its own). Returns the conversation id, or
 * null for accounts that don't get one (system accounts, unfinished onboarding).
 */
export async function ensureAgentWelcome(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      name: users.name,
      displayName: users.displayName,
      username: users.username,
      accountType: users.accountType,
      onboardingComplete: users.onboardingComplete,
      isSystemAccount: users.isSystemAccount,
    })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (!row || row.isSystemAccount || !row.onboardingComplete) return null;
  if (row.accountType !== "buyer" && row.accountType !== "seller") return null;

  const name = row.displayName ?? row.name;
  const result = await createWelcomeConversationOnce(userId, row.accountType, {
    name,
    handle: row.username ? `@${row.username}` : "",
    initials: name.trim().slice(0, 2).toUpperCase() || "U",
    color: "#8B5CF6",
  });
  ensured.add(userId);
  return result.conversationId;
}

/** Cheap guard for hot paths (GET /api/conversations): one DB round-trip per
 *  user per process, then a Set lookup. Never throws. */
export async function ensureAgentWelcomeOnce(userId: string): Promise<void> {
  if (ensured.has(userId)) return;
  try {
    await ensureAgentWelcome(userId);
  } catch (err) {
    logger.warn({ err, userId }, "Brandthread assistant: could not ensure welcome thread");
  }
}

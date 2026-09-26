import { Router } from "express";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import healthRouter from "./health";
import authRouter from "./auth";
import productsRouter from "./products";
import ordersRouter from "./orders";
import customersRouter from "./customers";
import dropsRouter from "./drops";
import analyticsRouter from "./analytics";
import integrationsRouter from "./integrations";
import logoRouter from "./logo";
import mockupRouter from "./mockup";
import photographyRouter from "./photography";
import bgRemovalRouter from "./bg-removal";
import lifestyleRouter from "./lifestyle";
import techpackRouter from "./techpack";
import manufacturersRouter from "./manufacturers";
import manufacturerPublicRouter from "./manufacturer-public";
import manufacturerConnectRouter from "./manufacturer-connect";
import manufacturerFlowRouter from "./manufacturer-flow";
import sampleOrdersRouter from "./sample-orders";
import dropWalletRouter from "./drop-wallet";
import inventoryRouter from "./inventory";
import sellerHubRouter from "./seller-hub";
import pushRouter from "./push";
import aiRouter from "./ai";
// New: buyer-facing, public browsing, Stripe Connect, webhooks
import publicRouter from "./public";
import profileMediaRouter from "./profile-media";
import profileCoverRouter from "./profile-cover";
import buyerRouter from "./buyer";
import guestCheckoutRouter from "./guest-checkout";
import connectRouter from "./connect";
import subscriptionRouter from "./subscription";
import webhooksRouter from "./webhooks";
import reviewsRouter from "./reviews";
import sellerProfileRouter from "./seller-profile";
import conversationsRouter from "./conversations";
import brandthreadAgentRouter from "./brandthread-agent";
import savedRouter from "./saved";
import collectionsRouter from "./collections";
import cartDbRouter from "./cart-db";
import notificationsFeedRouter from "./notifications-feed";
import notificationPrefsRouter from "./notification-prefs";
import postsRouter from "./posts";
import feedRouter from "./feed";
import reportsRouter from "./reports";
import postCommentsRouter from "./post-comments";
import moderationRouter from "./moderation";
import safetyRouter from "./safety";
import socialRouter from "./social";
import referralsRouter from "./referrals";
import shippingRatesRouter from "./shipping-rates";
import shippingZonesRouter from "./shipping-zones";
import shippingLabelsRouter from "./shipping-labels";
import disputesRouter from "./disputes";
import financeRouter from "./finance";
import taxesRouter from "./taxes";
import teamRouter from "./team";
import { requireRole, teamContext } from "../middlewares/requireRole";
import notificationEventsRouter from "./notification-events";

/** Lazily-resolved team context for routes that don't mount it themselves.
 *  `resolveTeamContext` is idempotent (cached on req.teamContext), so applying
 *  this at the index level alongside a route that already mounts it internally
 *  is a safe no-op on the second call. */
const tc = teamContext();
import storeRouter from "./store";
import storeAiRouter from "./store-ai";
import discountCodesRouter from "./discount-codes";
import returnsRouter from "./returns";
import sellerVerificationRouter from "./seller-verification";
import waitlistRouter from "./waitlist";
import bundlesRouter from "./bundles";
import buyerProductsRouter from "./buyer-products";
import recentlyViewedRouter from "./recently-viewed";
import sellerLocationsRouter from "./seller-locations";
import sellerMetafieldsRouter from "./seller-metafields";
import sellerSettingsExtRouter from "./seller-settings-route";
import buyerPaymentsRouter from "./buyer-payments";
import supportRouter from "./support";
import sellerExportRouter from "./seller-export";
import supportChatRouter from "./support-chat";
import freelancersRouter from "./freelancers";
import freelancerConnectRouter from "./freelancer-connect";
import freelancerJobsRouter from "./freelancer-jobs";
import boostsRouter    from "./boosts";
import adCampaignsRouter from "./ad-campaigns";
import metaAdsRouter from "./meta-ads";
import vacationRouter  from "./vacation";
import loyaltyRouter   from "./loyalty";
import threadCashRouter from "./thread-cash";
import callRouter      from "./call";
import featureFlagsRouter from "./feature-flags";
import ipCasesRouter from "./ip-cases";
import shopifyImportRouter from "./shopify-import";
import designStudioRouter from "./design-studio";
import packagePresetsRouter from "./package-presets";
import webhooksShippoRouter from "./webhooks-shippo";
import webhooksShopifyRouter from "./webhooks-shopify";
import shopifyOauthCallbackRouter from "./shopify-oauth-callback";
import shopifyRouter from "./shopify";

const router = Router();

// ─── Unauthenticated / special-body routes first ──────────────────────────────
router.use("/config/features", featureFlagsRouter);
router.use("/public",          publicRouter);
router.use("/public",          profileMediaRouter); // /users/:id/videos, /products/:id/feed-videos
router.use("/profile",         profileCoverRouter); // cover video (all account types) + first-visit coach mark
router.use("/guest/checkout",  guestCheckoutRouter);
router.use("/webhooks",        webhooksRouter);
router.use("/webhooks/shippo", webhooksShippoRouter);
router.use("/webhooks/shopify", webhooksShopifyRouter);
// Shopify's OAuth redirect hits the seller's browser directly (no Brandthread
// session) — mounted unauthenticated, before the authenticated /shopify group.
router.use("/shopify/oauth/callback", shopifyOauthCallbackRouter);
router.use("/support",         supportRouter);
router.use("/support-chat",    supportChatRouter);
router.use("/ip-cases",        ipCasesRouter);
// Specific seller sub-paths BEFORE the seller catch-all
router.use("/seller/export",   sellerExportRouter);

// ─── Authenticated seller + shared routes ─────────────────────────────────────
// tc (teamContext) is applied to every seller-scoped route so X-Store-Context
// is honoured consistently. resolveTeamContext is idempotent (cached on req),
// so routes that already mount it internally get a free no-op on the second call.
router.use("/call",            callRouter);
router.use("/healthz",         healthRouter);
router.use("/auth",            authRouter);
// This route is intentionally before paid AI mounts: it is the single,
// server-enforced sample offered during seller onboarding.
router.use("/onboarding-sample", logoRouter);
router.use("/products",        tc, productsRouter);
router.use("/orders",          tc, ordersRouter);
router.use("/customers",       tc, customersRouter);
router.use("/drops",           tc, dropsRouter);
router.use("/analytics",       tc, analyticsRouter);
router.use("/integrations",    tc, integrationsRouter);
router.use("/shopify",         tc, shopifyRouter);
// ─── Growth-plan-gated AI design routes ───────────────────────────────────────
router.use("/logo",            tc, requirePlan("growth"), logoRouter);
router.use("/mockup",          tc, requirePlan("growth"), mockupRouter);
router.use("/photography",     tc, requirePlan("growth"), photographyRouter);
router.use("/bg-removal",      tc, requirePlan("growth"), bgRemovalRouter);
router.use("/lifestyle",       tc, requirePlan("growth"), lifestyleRouter);
router.use("/techpack",        tc, requirePlan("growth"), techpackRouter);
// Specific manufacturer sub-paths BEFORE the catch-all manufacturersRouter
router.use("/manufacturers/public",          manufacturerPublicRouter);
router.use("/manufacturers/connect",         tc, manufacturerConnectRouter);
// Growth-plan-gated Manufacturer Hub
// Order cards + tracker (auth handled per route; falls through otherwise)
router.use("/manufacturers",   tc, manufacturerFlowRouter);
router.use("/manufacturers",   tc, manufacturersRouter);
router.use("/inventory",       tc, inventoryRouter);
router.use("/seller-hub",      tc, sellerHubRouter);
router.use("/push",            pushRouter);
router.use("/notification-prefs", notificationPrefsRouter);
router.use("/ai",              tc, aiRouter);

// ─── Buyer & Seller Connect / Subscription routes ─────────────────────────────
// Mount specific sub-paths before the catch-all /buyer router so they don't
// get swallowed by buyerRouter's lack of those handlers.
// Buyer routes are intentionally NOT wrapped with tc — buyer context must stay
// scoped to the actual buyer, not the team store owner.
router.use("/waitlist",                  tc, waitlistRouter);
router.use("/bundles",                   tc, bundlesRouter);
router.use("/buyer/products",            buyerProductsRouter);
router.use("/buyer/recently-viewed",     recentlyViewedRouter);
router.use("/buyer/saved",               savedRouter);
router.use("/buyer/collections",         collectionsRouter);
router.use("/buyer/cart",                cartDbRouter);
router.use("/buyer/notifications",       notificationsFeedRouter);
router.use("/notifications",             notificationEventsRouter);
router.use("/buyer",                     buyerRouter);
router.use("/conversations",             conversationsRouter);
router.use("/brandthread-agent",         brandthreadAgentRouter);
router.use("/seller/connect",            requireRole("owner"), connectRouter);      // payouts: owner only; requireRole resolves tc internally
router.use("/seller/subscription",       subscriptionRouter); // router applies manager reads and owner mutations after team context
router.use("/seller/verification",       tc, sellerVerificationRouter);
router.use("/seller",                    tc, sellerProfileRouter);
router.use("/reviews",                   tc, reviewsRouter);
// Comments are attributed to the person writing them, so they are mounted
// ahead of the team-context posts router.
router.use("/posts",                     postCommentsRouter);
router.use("/posts",                     tc, postsRouter);
router.use("/feed",                      feedRouter); // buyer-scoped (For You ranking + event ingestion); no tc
router.use("/reports",                   reportsRouter);
router.use("/moderation",                moderationRouter);
router.use("/safety",                    safetyRouter);
router.use("/social",                    socialRouter);
router.use("/referrals",                 referralsRouter);
router.use("/shipping-rates",            tc, shippingRatesRouter);
router.use("/shipping-zones",            shippingZonesRouter); // router mounts requireAuth/teamContext itself after its public /resolve endpoint
router.use("/shipping-labels",           shippingLabelsRouter);
router.use("/discount-codes",            tc, discountCodesRouter);
router.use("/returns",                   tc, returnsRouter);
router.use("/sample-orders",             tc, sampleOrdersRouter);
router.use("/drop-wallets",              tc, dropWalletRouter);
router.use("/disputes",                  tc, disputesRouter);
router.use("/finance",                   financeRouter); // router applies manager reads and owner mutations after team context
router.use("/taxes",                     tc, taxesRouter);
// teamRouter owns its middleware ordering so membership discovery sees the
// actual caller before any store-context rewrite.
router.use("/team",                      teamRouter);
router.use("/store/ai",                  tc, storeAiRouter);
router.use("/store",                     tc, storeRouter);
router.use("/design-studio",             requireAuth, tc, designStudioRouter);
router.use("/shopify-imports",           tc, shopifyImportRouter);

// ─── Freelancer marketplace (Community tab) ───────────────────────────────────
// Connect sub-path BEFORE the generic /freelancers router so /connect/* isn't
// swallowed by /freelancers/:id.
router.use("/freelancers/connect",       tc, freelancerConnectRouter);
router.use("/freelancers",               tc, freelancersRouter);
router.use("/freelancer-jobs",           tc, freelancerJobsRouter);

// ─── New seller settings + buyer payments routes ──────────────────────────────
router.use("/seller/locations",          tc, sellerLocationsRouter);
router.use("/seller/metafields",         tc, sellerMetafieldsRouter);
router.use("/seller/settings",           tc, sellerSettingsExtRouter);
router.use("/buyer/payment-methods",     buyerPaymentsRouter);

// ─── Live shopping ─────────────────────────────────────────────────────────────
import liveRouter from "./live";
// Watching is open to every signed-in user; the host-only routes inside
// (start / end / products) apply requirePlan("pro") themselves.
router.use("/live",                      tc, liveRouter);

// ─── Paid boosts, vacation mode, loyalty/rewards ──────────────────────────────
router.use("/boosts",                    tc, requirePlan("pro"), boostsRouter);
router.use("/ad-campaigns",              tc, adCampaignsRouter);
router.use("/meta-ads",                  tc, metaAdsRouter);
router.use("/seller/vacation",          tc, vacationRouter);
router.use("/seller/notification-prefs", tc, notificationPrefsRouter);
router.use("/loyalty",             loyaltyRouter); // buyer-scoped; no tc
router.use("/thread-cash",         threadCashRouter); // buyer-scoped; no tc

export default router;

import { Router } from "express";
import { reviewTextModeration } from "../middlewares/reviewTextModeration";
import { requireAuth, requirePlan } from "../middlewares/requireAuth";
import { featureGate } from "../middlewares/featureGate";
import { pushBroadcastAllowance } from "../middlewares/pushBroadcastAllowance";
import { aiSafetyGuard } from "../middlewares/aiSafetyGuard";
import { requireAiConsent } from "../middlewares/requireAiConsent";
import healthRouter from "./health";
import { responseCache, invalidateResponseCache, bumpResponseCacheGeneration } from "../middlewares/responseCache";
import authRouter from "./auth";
import accountsRouter from "./accounts";
import ageRouter from "./age";
import productsRouter from "./products";
import ordersRouter from "./orders";
import customersRouter from "./customers";
import dropsRouter from "./drops";
import analyticsRouter from "./analytics";
import widgetSummaryRouter from "./widgetSummary";
import analyticsInsightsRouter from "./analytics-insights";
import integrationsRouter from "./integrations";
import logoRouter, { onboardingSampleRouter } from "./logo";
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
import productVariantsRouter from "./product-variants";
import catalogPublicRouter from "./catalog-public";
import sellerHubRouter from "./seller-hub";
import pushRouter from "./push";
import liveActivitiesRouter from "./liveActivities";
import aiRouter from "./ai";
import aiCreditsRouter from "./ai-credits";
import aiHelpersRouter from "./ai-helpers";
import { aiCreditsGate } from "../lib/aiCredits/gate";
import { aiConsentGate } from "../lib/aiConsent";
import aiConsentRouter from "./ai-consent";
// New: buyer-facing, public browsing, Stripe Connect, webhooks
import publicRouter from "./public";
import accountDeletionPublicRouter from "./account-deletion-public";
import discoveryRouter from "./discovery";
import featuredPublicRouter from "./featured-public";
import storeTrustRouter from "./store-trust";
import adminRouter from "./admin";
import { auditModerationActions } from "../lib/admin/moderationAudit";
import profileMediaRouter from "./profile-media";
import profileCoverRouter from "./profile-cover";
import avatarVideoRouter from "./avatar-video";
import buyerRouter from "./buyer";
import checkoutIntentRouter, { guestCheckoutIntentRouter } from "./checkout-intent";
import orderAddOnRouter from "./order-add-on";
import guestCheckoutRouter from "./guest-checkout";
import connectRouter, { connectRedirectRouter } from "./connect";
import {
  buyerPostPurchaseRouter, checkoutProfileRouter, sellerConversionTrackingRouter, sellerPostPurchaseOfferRouter,
} from "./checkout-extras";
import subscriptionRouter from "./subscription";
import subscriptionRetentionRouter from "./subscription-retention";
import webhooksRouter from "./webhooks";
import reviewsRouter from "./reviews";
import productQaRouter from "./product-qa";
import sellerProfileRouter from "./seller-profile";
import conversationsRouter from "./conversations";
import communitiesRouter from "./communities";
import brandthreadAgentRouter from "./brandthread-agent";
import savedRouter from "./saved";
import collectionsRouter from "./collections";
import productBulkRouter from "./product-bulk";
import productSeoRouter from "./product-seo";
import productPageDetailsRouter from "./product-page-details";
import cartDbRouter from "./cart-db";
import notificationsFeedRouter from "./notifications-feed";
import notificationPrefsRouter from "./notification-prefs";
import smsPrefsRouter from "./notification-prefs-sms";
import postsRouter from "./posts";
import fitsRouter, { productFitChecksRouter } from "./fits";
import postCaptionsRouter from "./post-captions";
import postPollsRouter from "./post-polls";
import postPinsRouter from "./post-pins";
import postMentionsLabelsRouter from "./post-mentions-labels";
import feedRouter from "./feed";
import feedFollowedFreshRouter from "./feed-followed-fresh";
import reportsRouter from "./reports";
import accountStatusRouter from "./account-status";
import postCommentsRouter from "./post-comments";
import commentMediaRouter from "./comment-media";
import moderationRouter from "./moderation";
import safetyRouter from "./safety";
import interactionSettingsRouter from "./interaction-settings";
import remixRouter from "./remix";
import displayPreferencesRouter from "./display-preferences";
import translateRouter from "./translate";
import hiddenWordsRouter from "./hidden-words";
import socialRouter from "./social";
import storyMentionsRouter from "./story-mentions";
import closeFriendsRouter from "./close-friends";
import storyHighlightsRouter from "./story-highlights";
import hashtagsRouter from "./hashtags";
import followRequestsRouter from "./follow-requests";
import placesRouter from "./places";
import storyStickersRouter from "./story-stickers";
import referralsRouter from "./referrals";
import sellerReferralsRouter from "./seller-referrals";
import shippingRatesRouter from "./shipping-rates";
import shippingZonesRouter from "./shipping-zones";
import shippingLabelsRouter from "./shipping-labels";
import disputesRouter from "./disputes";
import financeRouter from "./finance";
import financeStatementsRouter from "./finance-statements";
import { financeFeesRouter, publicFeeScheduleRouter } from "./fees";
import { publicWebAnnualPlansRouter } from "./web-annual-plans";
import taxesRouter from "./taxes";
import sellerPaymentSettingsRouter, { publicPayLaterRouter } from "./seller-payment-settings";
import fxRouter from "./fx";
import teamRouter from "./team";
import { requireRole, teamContext } from "../middlewares/requireRole";
import notificationEventsRouter from "./notification-events";
import accountMutesRouter from "./account-mutes";

/** Lazily-resolved team context for routes that don't mount it themselves.
 *  `resolveTeamContext` is idempotent (cached on req.teamContext), so applying
 *  this at the index level alongside a route that already mounts it internally
 *  is a safe no-op on the second call. */
const tc = teamContext();
import storeRouter from "./store";
import storeAddressRouter from "./store-address";
import emailMarketingRouter from "./email-marketing";
import emailMarketingPublicRouter from "./email-marketing-public";
import sellerEmailsPublicRouter from "./seller-emails-public";
import emailMarketingWebhookRouter from "./email-marketing-webhook";
import storeAiRouter from "./store-ai";
import discountCodesRouter from "./discount-codes";
import emailOptInRouter from "./email-opt-in";
import salesRouter from "./sales";
import returnsRouter from "./returns";
import returnLabelsRouter from "./return-labels";
import sellerVerificationRouter from "./seller-verification";
import productLaunchesRouter from "./product-launches";
import preorderTermsRouter from "./preorder-terms";
import waitlistRouter from "./waitlist";
import bundlesRouter from "./bundles";
import mysteryBoxesRouter, { buyerMysteryBoxesRouter } from "./mystery-boxes";
import productPairingsRouter from "./product-pairings";
import productDraftsRouter from "./product-drafts";
import productVideosRouter from "./product-videos";
import buyerProductsRouter from "./buyer-products";
import sizeChartTemplatesRouter from "./size-chart-templates";
import recentlyViewedRouter from "./recently-viewed";
import firstRunTipsRouter from "./first-run-tips";
import sellerLaunchChecklistRouter from "./seller-launch-checklist";
import sellerMorningBriefRouter from "./seller-morning-brief";
import sellerMilestonesRouter from "./seller-milestones";
import sellerLocationsRouter from "./seller-locations";
import sellerTerminalRouter from "./seller-terminal";
import sellerMetafieldsRouter from "./seller-metafields";
import sellerSettingsExtRouter from "./seller-settings-route";
import buyerPaymentsRouter from "./buyer-payments";
import buyerPreferencesRouter from "./buyer-preferences";
import userSettingsRouter from "./user-settings";
import buyerRecommendedBrandsRouter from "./buyer-recommended-brands";
import tasteQuizRouter from "./taste-quiz";
import socialContactsRouter from "./social-contacts";
import supportRouter from "./support";
import sellerExportRouter from "./seller-export";
import dataExportJobsRouter from "./data-export-jobs";
import supportChatRouter from "./support-chat";
import freelancersRouter from "./freelancers";
import freelancerConnectRouter from "./freelancer-connect";
import freelancerJobsRouter from "./freelancer-jobs";
import boostsRouter    from "./boosts";
import promotionsRouter from "./promotions";
import featuredSlotsRouter from "./featured-slots";
import adminPromotionsRouter from "./admin-promotions";
import adCampaignsRouter from "./ad-campaigns";
import iapPromotionsRouter from "./iap-promotions";
import adsServeRouter from "./ads-serve";
import metaAdsRouter from "./meta-ads";
import vacationRouter  from "./vacation";
import { quickRepliesRouter, awayMessageRouter } from "./seller-messaging-tools";
import linkPreviewRouter from "./link-preview";
import loyaltyRouter   from "./loyalty";
import threadCashRouter from "./thread-cash";
import giftCardsRouter from "./gift-cards";
import callRouter      from "./call";
import featureFlagsRouter from "./feature-flags";
import appConfigRouter from "./app-config";
import sellerPlanConfigRouter from "./seller-plan-config";
import configLiveRouter from "./config-live";
import accessRouter from "./access";
import ipCasesRouter from "./ip-cases";
import shopifyImportRouter from "./shopify-import";
import productImportRouter, { etsyCallbackRouter as etsyImportCallbackRouter } from "./product-import";
import designStudioRouter from "./design-studio";
import packagePresetsRouter from "./package-presets";
import webhooksShippoRouter from "./webhooks-shippo";
import releaseTestControlRouter from "./release-test-control";
import webhooksShopifyRouter from "./webhooks-shopify";
import uploadSessionsRouter from "./upload-sessions";
import muxWebhookRouter from "./webhooks-mux";
import webhooksTwilioRouter from "./webhooks-twilio";
import shopifyOauthCallbackRouter from "./shopify-oauth-callback";
import shopifyRouter from "./shopify";
import sharePreviewRouter from "./share-preview";
import publicMediaRouter from "./public-media";
import metaCapiPublicRouter from "./meta-capi-public";
import sitemapRouter from "./sitemap";
import seoPublicRouter from "./seo-public";
import wellKnownRouter from "./wellKnown";
import affiliatePublicRouter from "./affiliate-public";
import affiliateCreatorRouter, { affiliateConnectRedirectRouter } from "./affiliate-creator";
import sellerAffiliateRouter from "./seller-affiliate";
import growthRouter from "./growth";
import storeBlocksRouter from "./storeBlocks";
import { publicProductFeedRouter, sellerProductFeedRouter } from "./product-feed";
import { trackedLinkRedirect } from "./growthPublic";
import sellerPushBroadcastsRouter from "./seller-push-broadcasts";
import { sellerGiveawaysRouter, publicGiveawaysRouter } from "./giveaways";
import geoPostalRouter from "./geo-postal";
import appInstallsRouter from "./app-installs";
import { killSwitchGate } from "../lib/killSwitches";
import dropWaitlistPublicRouter from "./drop-waitlist-public";

const router = Router();
router.use(aiConsentGate);

// Review and seller-reply text goes through the public content filter before
// the reviews router (see middlewares/reviewTextModeration.ts).
router.use("/reviews", reviewTextModeration);

// ─── Unauthenticated / special-body routes first ──────────────────────────────
router.use("/config/features", featureFlagsRouter);
router.use("/app",             appConfigRouter); // GET /config: min supported app version, release flags (no auth, no DB)
router.use("/config/seller-plans", sellerPlanConfigRouter);
router.use("/config/live", configLiveRouter); // public: { liveAvailable } (Agora configured)
router.use("/geo",           geoPostalRouter); // GET /postal/US/:zip (no auth, rate-limited): ZIP → city/state for checkout
router.use("/app/installs",    appInstallsRouter); // first-launch install ping (admin funnel), works signed out
router.use(killSwitchGate); // Live / Payments / AI kill switches (Admin → Kill switches); write entry points only
// Apple Wallet pre-order passes: status + signed download are public, the link route requires auth itself.
router.use("/wallet",          walletPassesRouter);
router.use("/fx",             fxRouter); // GET /rates public (display-only currency, intl #107); /display-currency authed per route
router.use("/public/account-deletion", accountDeletionPublicRouter);
router.use("/public",          publicFeeScheduleRouter); // GET /fee-schedule (no auth)
router.use("/public",          publicWebAnnualPlansRouter); // GET /web-annual-plans (no auth; empty until a yearly web price is set)
router.use("/public",          publicPayLaterRouter); // GET /sellers/:sellerId/pay-later (no auth, BNPL line on product page)
router.use("/public/affiliate", affiliatePublicRouter); // creator link click tracking (rate-limited, no private data)
router.use("/public/feeds",     publicProductFeedRouter); // secret-token Meta / TikTok catalog CSV feeds (public data only)
// Tracked short links under /api too: on brandthread.app only /api/* reaches this
// server, so printed QR stickers encode /api/l/:code (same handler as /l/:code).
router.get("/l/:code",         trackedLinkRedirect);
router.use("/public",          emailMarketingPublicRouter); // /stores/:slug/subscribe, /email/unsubscribe/:token
router.use("/public",          sellerEmailsPublicRouter); // /seller-emails/unsubscribe/:token (store tips)
router.use("/public/drop-waitlist", dropWaitlistPublicRouter); // brandthread.app/@handle/drop data + phone signup
router.use("/access",          accessRouter); // invite-only launch: validate/waitlist public, status/redeem authed
router.use("/public/featured", featuredPublicRouter); // admin-curated Discover picks
router.use("/public/store-trust", storeTrustRouter); // "Ships in N days" + detail ratings for a store
// Shared response cache for the public read paths that dominate traffic. A no-op
// unless REDIS_URL is set. Registered before the routers so a hit never reaches
// them. See docs/scale/CACHE.md for keys, TTLs and invalidation.
router.get("/public/search", responseCache({ name: "search", ttlSeconds: 30, scope: "viewer-blocks", generational: true }));
router.get("/public/profiles/:username", responseCache({ name: "profile", ttlSeconds: 20, scope: "viewer-blocks" }));
router.get("/public/products/:id", responseCache({ name: "product", ttlSeconds: 15, scope: "anon", idKey: (req) => String(req.params.id) }));
// A seller edit or delete drops the cached product page immediately, and any
// product write (publish, edit, delete) starts a fresh search generation so
// the change is searchable on the very next request.
router.use("/products", (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") { next(); return; }
  const id = /^\/([0-9a-f-]{36})(\/|$)/i.exec(req.path)?.[1];
  res.once("finish", () => {
    if (res.statusCode >= 400) return;
    if (id) void invalidateResponseCache("product", id);
    void bumpResponseCacheGeneration("search");
  });
  next();
});
// Bulk edits and imports change what search returns too.
const bumpSearchOnWrite: import("express").RequestHandler = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.once("finish", () => { if (res.statusCode < 400) void bumpResponseCacheGeneration("search"); });
  }
  next();
};
router.use(["/product-bulk", "/shopify-imports", "/product-import", "/product-launches"], bumpSearchOnWrite);
router.use("/public",          publicRouter);
router.use("/public",          sharePreviewRouter); // /posts/:id/share-preview, /stores/:slug/share-preview (OG data)
router.use("/public",          sitemapRouter); // /sitemap.xml — products, seller profiles, drops (served at brandthread.app/sitemap.xml)
router.use("/public/meta",     metaCapiPublicRouter); // POST /conversion-events — CAPI credited to the product's seller (BT-325)
router.use("/public",          publicMediaRouter); // /media/products/:id/:index — public product photo (share cards, bio, email)
router.use("/public",          seoPublicRouter); // /seo/products/:id, /new-this-week, /seo/sitemap/:kind, /invites/:code/share-preview
// brandthread.app only routes /api/* here, so the web server (serve.js)
// proxies /.well-known/* from this mirror of the root verification files.
router.use("/public/well-known", wellKnownRouter);
router.use("/public",          discoveryRouter); // /categories, /trending/products, /trending/brands
router.use("/public",          profileMediaRouter); // /users/:id/videos, /products/:id/feed-videos
router.use("/profile",         profileCoverRouter); // cover video (all account types) + first-visit coach mark
router.use("/profile",         avatarVideoRouter);  // avatar video (moving profile picture), all account types
// Guest in-app payment (BT-257): no Clerk; card-data guard + guest token inside. Rate limited as checkout.
router.use("/guest/checkout/payment-intent", guestCheckoutIntentRouter);
router.use("/guest/checkout",  guestCheckoutRouter);
router.use("/webhooks/resend-marketing", emailMarketingWebhookRouter);
router.use("/checkout-profile", checkoutProfileRouter); // public: store language + checkout mode for the buyer checkout
router.use("/webhooks/twilio", webhooksTwilioRouter); // inbound SMS STOP/START for the drop waitlist
router.use("/webhooks",        webhooksRouter);
router.use("/webhooks/shippo", webhooksShippoRouter);
router.use("/webhooks/shopify", webhooksShopifyRouter);
router.use("/webhooks/mux",     muxWebhookRouter); // HLS transcode status (off unless MUX_* env is set)
// Shopify's OAuth redirect hits the seller's browser directly (no Brandthread
// session) — mounted unauthenticated, before the authenticated /shopify group.
router.use("/shopify/oauth/callback", shopifyOauthCallbackRouter);
router.use("/support",         supportRouter);
// AI data consent (App Store 5.1.2(i), QA-0043): no AI endpoint (support chat
// and the AI credits catalogue) sends a person's content to a provider, or
// debits credits, without their stored yes. Only acts on those paths.
router.use("/ai-consent",      aiConsentRouter);
router.use("/support-chat",    aiSafetyGuard("support-chat", { mode: "chat" }), supportChatRouter);
router.use("/ip-cases",        ipCasesRouter);
router.use("/release-test-control", releaseTestControlRouter);
// Specific seller sub-paths BEFORE the seller catch-all
router.use("/seller/export",   sellerExportRouter);
router.use("/giveaways",       publicGiveawaysRouter); // public reads; per-viewer entry status when signed in

// ─── Authenticated seller + shared routes ─────────────────────────────────────
// tc (teamContext) is applied to every seller-scoped route so X-Store-Context
// is honoured consistently. resolveTeamContext is idempotent (cached on req),
// so routes that already mount it internally get a free no-op on the second call.
// AI credits: debits every paid AI endpoint listed in lib/aiCredits/catalogue.ts
// (and refunds on error). Must stay ahead of the AI routers below.
router.use(aiCreditsGate);
// Support chat stays open to every signed-in account (buyers included); it sits
// below the gate so its messages are metered (daily ceiling + global AI cap).
router.use("/support-chat",    aiSafetyGuard("support-chat", { mode: "chat" }), supportChatRouter);
router.use("/ai/credits",      aiCreditsRouter);
router.use("/ai-helpers",      tc, aiHelpersRouter); // caption, product description, size chart, save (priced in AI_TOOL_RULES)
router.use("/call",            callRouter);
router.use("/healthz",         healthRouter);
router.use("/auth/data-export", dataExportJobsRouter); // async emailed export (/jobs*, /download); instant POST stays in authRouter
router.use("/auth",            authRouter);
router.use("/accounts",        accountsRouter); // one login = one buyer + one seller profile
router.use("/auth",            ageRouter); // POST /auth/age (age gate)
// This route is intentionally before paid AI mounts: it is the single,
// server-enforced sample offered during seller onboarding. Only the sample
// handler is mounted here (never the paid /logo/generate); the AI gate meters
// it against the global cap and a per-user daily ceiling.
router.use("/onboarding-sample", aiSafetyGuard("onboarding-logo"), onboardingSampleRouter);
router.use("/products",        productFitChecksRouter); // public GET /:id/fit-checks (F6 fits)
router.use("/products",        tc, productsRouter);
router.use("/orders",          tc, ordersRouter);
router.use("/customers",       tc, customersRouter);
router.use("/drops",           tc, featureGate("drops", { only: [{ method: "POST", path: "/" }] }), dropsRouter); // new drops: Growth+
router.use("/analytics/insights", tc, analyticsInsightsRouter);
router.use("/analytics/widget-summary", tc, widgetSummaryRouter); // iOS seller widgets (nativeSurfaces flag)
router.use("/analytics",       tc, analyticsRouter);
router.use("/integrations",    tc, integrationsRouter);
router.use("/shopify",         tc, shopifyRouter);
// ─── Growth-plan-gated AI design routes ───────────────────────────────────────
router.use("/logo",            tc, requirePlan("growth"), aiSafetyGuard("logo"), logoRouter);
router.use("/mockup",          tc, requirePlan("growth"), aiSafetyGuard("mockup"), mockupRouter);
router.use("/photography",     tc, requirePlan("growth"), aiSafetyGuard("photography"), photographyRouter);
router.use("/bg-removal",      tc, requirePlan("growth"), aiSafetyGuard("bg-removal"), bgRemovalRouter);
router.use("/lifestyle",       tc, requirePlan("growth"), aiSafetyGuard("lifestyle"), lifestyleRouter);
router.use("/techpack",        tc, requirePlan("growth"), aiSafetyGuard("techpack", { mode: "chat", scan: "all" }), techpackRouter);
// Specific manufacturer sub-paths BEFORE the catch-all manufacturersRouter
router.use("/manufacturers/public",          manufacturerPublicRouter);
router.use("/manufacturers/connect",         tc, manufacturerConnectRouter);
// Growth-plan-gated Manufacturer Hub
// Order cards + tracker (auth handled per route; falls through otherwise)
router.use("/manufacturers",   tc, manufacturerFlowRouter);
router.use("/manufacturers",   tc, manufacturersRouter);
router.use("/inventory",       tc, inventoryRouter);
router.use("/product-variants", tc, productVariantsRouter);
router.use("/catalog-public",   catalogPublicRouter);
router.use("/seller-hub",      tc, featureGate("manufacturer_hub", { only: [{ method: "POST", path: "/quote-requests", when: (req) => req.body?.type !== "sample" }, { method: "POST", path: "/rfqs" }] }), sellerHubRouter); // quotes + RFQs: Growth+, sample requests: every plan
router.use("/push",            pushRouter);
router.use("/live-activities", liveActivitiesRouter); // iOS Live Activity APNs tokens; requireAuth per route, no team context
router.use("/notification-prefs/sms", smsPrefsRouter); // opt-in SMS order updates (Twilio)
router.use("/notification-prefs", notificationPrefsRouter);
router.use("/ai",              tc, aiSafetyGuard("ai-chat", { mode: "chat" }), aiRouter);

// ─── Buyer & Seller Connect / Subscription routes ─────────────────────────────
// Mount specific sub-paths before the catch-all /buyer router so they don't
// get swallowed by buyerRouter's lack of those handlers.
// Buyer routes are intentionally NOT wrapped with tc — buyer context must stay
// scoped to the actual buyer, not the team store owner.
router.use("/product-launches",          tc, productLaunchesRouter);
router.use("/preorder-terms",            tc, preorderTermsRouter);
router.use("/waitlist",                  tc, waitlistRouter);
router.use("/bundles",                   tc, bundlesRouter);
router.use("/mystery-boxes",             tc, mysteryBoxesRouter);
router.use("/buyer/mystery-boxes",       buyerMysteryBoxesRouter);
router.use("/product-pairings",          productPairingsRouter);
router.use("/product-drafts",            tc, productDraftsRouter); // Add Product wizard drafts synced across devices
router.use("/product-videos",            productVideosRouter);
router.use("/buyer/products",            buyerProductsRouter);
router.use("/buyer/preferences",         buyerPreferencesRouter);
router.use("/me/settings",               userSettingsRouter);
router.use("/size-chart-templates",      tc, sizeChartTemplatesRouter);
router.use("/buyer/recommended-brands",  buyerRecommendedBrandsRouter);
router.use("/buyer/taste-quiz",          tasteQuizRouter);
router.use("/buyer/recently-viewed",     recentlyViewedRouter);
router.use("/first-run-tips",            firstRunTipsRouter);
router.use("/buyer/saved",               savedRouter);
router.use("/buyer/collections",         collectionsRouter);
router.use("/product-bulk",              productBulkRouter);
router.use("/product-seo",               productSeoRouter);
router.use("/product-page-details",      productPageDetailsRouter);
router.use("/buyer/cart",                cartDbRouter);
// One-page checkout (one PaymentIntent per cart). Before /buyer so its card-data guard runs first.
router.use("/buyer/checkout/payment-intent", checkoutIntentRouter);
// Post-purchase offer on the order confirmation (seller Checkout settings). Before /buyer.
router.use("/buyer/post-purchase",       buyerPostPurchaseRouter);
router.use("/buyer/add-on", orderAddOnRouter);
router.use("/buyer/notifications",       notificationsFeedRouter);
router.use("/notifications",             notificationEventsRouter);
router.use("/social/mutes",              accountMutesRouter); // account mutes (GET/POST/DELETE); the /social routers define no /mutes route
router.use("/buyer",                     buyerRouter);
router.use("/conversations",             conversationsRouter);
// Topic group chats (unlimited members). Public discovery + invite preview are
// declared inside before the router applies requireAuth.
router.use("/communities",               communitiesRouter);
// requireAiConsent runs before aiSafetyGuard so no text reaches OpenAI (moderation included) without consent.
router.use("/brandthread-agent",         requireAiConsent(), aiSafetyGuard("brandthread-agent", { mode: "chat" }), brandthreadAgentRouter);
// Stripe redirects the seller's browser here with no app session: mounted before the owner-only router.
router.use("/seller/connect/onboard",    connectRedirectRouter);
router.use("/seller/affiliate",          tc, sellerAffiliateRouter); // affiliate / creator program (seller side)
router.use("/seller/connect",            requireRole("owner"), connectRouter);      // payouts: owner only; requireRole resolves tc internally
router.use("/seller/subscription",       subscriptionRouter); // router applies manager reads and owner mutations after team context
router.use("/seller/subscription-retention", subscriptionRetentionRouter); // pause instead of cancel (Stripe plans)
router.use("/seller/verification",       tc, sellerVerificationRouter);
router.use("/seller/push-broadcasts",    tc, pushBroadcastAllowance, sellerPushBroadcastsRouter); // weekly allowance per plan
router.use("/seller/giveaways",          tc, sellerGiveawaysRouter);
router.use("/seller/launch-checklist",   tc, sellerLaunchChecklistRouter);
// Checkout settings: post-purchase offer + conversion tracking ("Additional scripts").
router.use("/seller/post-purchase-offer", tc, sellerPostPurchaseOfferRouter);
router.use("/seller/conversion-tracking", tc, sellerConversionTrackingRouter);
router.use("/seller/terminal",           tc, sellerTerminalRouter); // Pop-up mode (Tap to Pay); 503 unless STRIPE_TERMINAL_ENABLED=1
router.use("/seller/morning-brief",      tc, sellerMorningBriefRouter);
router.use("/seller/milestones",         tc, sellerMilestonesRouter);
router.use("/seller",                    tc, sellerProfileRouter);
router.use("/reviews",                   tc, reviewsRouter);
router.use("/product-qa",                tc, productQaRouter);
// Comments are attributed to the person writing them, so they are mounted
// ahead of the team-context posts router.
router.use("/posts",                     postCommentsRouter);
router.use("/comment-media",             commentMediaRouter);
router.use("/posts",                     postCaptionsRouter);
router.use("/posts",                     postPollsRouter); // Thread polls: /posts/polls, /posts/:postId/poll[/vote]
router.use("/posts",                     postPinsRouter); // Pin to your profile: /posts/pins/mine, /posts/:id/pin
router.use("/posts",                     postMentionsLabelsRouter); // product mentions + BTS label (per-route team context)
router.use("/posts",                     tc, postsRouter);
router.use("/upload-sessions",           uploadSessionsRouter); // resumable chunked uploads; owned by the signed-in person, no tc
router.use("/fits",                      fitsRouter); // stitches, buyer fit checks, brand repost requests
router.use("/feed",                      feedRouter); // buyer-scoped (For You ranking + event ingestion); no tc
router.use("/feed",                      feedFollowedFreshRouter); // GET /followed-fresh (requireAuth); no tc
router.use("/reports",                   reportsRouter);
router.use("/account-status",            accountStatusRouter); // strikes + your reports (signed-in)
router.use("/moderation",                auditModerationActions, moderationRouter);
router.use("/admin",                     adminRouter); // platform admin dashboard API (users.role = admin)
router.use("/safety/hidden-words",       hiddenWordsRouter); // creator's own comment filter
router.use("/safety",                    safetyRouter);
router.use("/social/contacts",           socialContactsRouter);
router.use("/interaction-settings",      interactionSettingsRouter); // comment/repost/download + hidden-story settings; download check is public
router.use("/remix",                     remixRouter); // video remixes: permission check + source clip copy (lib/remix.ts)
router.use("/display-preferences",       displayPreferencesRouter); // translation language, auto-translate, text size, high-contrast icons
router.use("/translate",                 translateRouter); // caption/comment translation (expensive rate limit, cached)
router.use("/social",                    socialRouter);
router.use("/social",                    storyMentionsRouter);
router.use("/social",                    closeFriendsRouter);
router.use("/social",                    storyHighlightsRouter);
router.use("/hashtags",                  hashtagsRouter); // public reads (optional viewer); follow endpoints require auth
router.use("/social",                    followRequestsRouter);
router.use("/places",                    placesRouter); // public reads (optional viewer); POST requires auth
router.use("/social",                    storyStickersRouter);
router.use("/affiliate/connect",         affiliateConnectRedirectRouter); // Stripe return/refresh for creators (no session, BT-323)
router.use("/referrals",                 referralsRouter);
router.use("/seller-referrals",          sellerReferralsRouter); // brand → brand free month (BT-313, off unless SELLER_REFERRAL_ENABLED=true)
router.use("/affiliate",                 affiliateCreatorRouter); // creator side; acts as the signed-in user, no tc
router.use("/affiliate",                 affiliateCreatorRouter); // creator side; acts as the signed-in user, no tc
router.use("/shipping-rates",            tc, shippingRatesRouter);
router.use("/shipping-zones",            shippingZonesRouter); // router mounts requireAuth/teamContext itself after its public /resolve endpoint
router.use("/shipping-labels",           shippingLabelsRouter);
router.use("/package-presets",           packagePresetsRouter); // router applies requireAuth/teamContext itself
router.use("/discount-codes",            tc, discountCodesRouter);
router.use("/sales",                     tc, salesRouter);
router.use("/returns",                   tc, returnsRouter);
router.use("/return-labels",             returnLabelsRouter);
router.use("/sample-orders",             tc, featureGate("manufacturer_hub", { only: [{ method: "POST", path: "/", when: (req) => req.body?.orderType === "bulk" }] }), sampleOrdersRouter); // bulk orders: Growth+, samples: every plan
router.use("/drop-wallets",              tc, dropWalletRouter);
router.use("/disputes",                  tc, disputesRouter);
router.use("/finance/statements",        financeStatementsRouter);
router.use("/finance/fees",              financeFeesRouter); // before financeRouter: no payout permission needed
router.use("/finance",                   financeRouter); // router applies manager reads and owner mutations after team context
router.use("/taxes",                     tc, taxesRouter);
router.use("/seller/payment-settings",    tc, sellerPaymentSettingsRouter);
// teamRouter owns its middleware ordering so membership discovery sees the
// actual caller before any store-context rewrite.
router.use("/team",                      teamRouter);
router.use("/store/ai",                  tc, aiSafetyGuard("store-ai", { mode: "chat", scan: "all" }), storeAiRouter);
router.use("/store",                     tc, storeAddressRouter); // /address, /slug, custom-domain gate (BT-307/317/318) — before storeRouter
router.use("/store",                     tc, featureGate("custom_domain", { only: [{ method: "POST", path: "/domains" }] }), storeRouter); // adding a domain: Growth+
router.use("/marketing/email",           tc, emailMarketingRouter);
router.use("/buyer/email-opt-in",         emailOptInRouter); // "Get emails from {store}" at checkout / on Follow
router.use("/design-studio",             requireAuth, tc, designStudioRouter);
router.use("/shopify-imports",           tc, shopifyImportRouter);
// Etsy redirects the browser to the callback with no session; it is mounted before the authenticated group.
router.use("/product-import/etsy/callback", etsyImportCallbackRouter);
router.use("/product-import",             tc, productImportRouter);

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
import liveCommerceRouter from "./live-commerce";
import liveAnalyticsRouter from "./live-analytics";
router.use("/live",                      tc, liveAnalyticsRouter);
// Watching is open to every signed-in user; the host-only routes inside
// (start / products / pins) apply the live_hosting gate (middlewares/featureGate.ts) themselves.
// Moderation + co-host routers MUST be mounted before liveRouter: they own
// literal paths (/moderation-defaults, /cohost-*) that liveRouter's GET /:id would otherwise swallow.
import liveModerationRouter from "./live-moderation";
import liveCohostRouter from "./live-cohost";
router.use("/live",                      tc, liveModerationRouter);
router.use("/live",                      tc, liveCohostRouter);
import liveAuctionsRouter from "./live-auctions";
router.use("/live",                      tc, liveAuctionsRouter); // Auctions for 1-of-1s (live_auctions flag) — before liveRouter's /:id
router.use("/live",                      tc, liveCommerceRouter); // Pin / live codes / scheduled — before liveRouter so /scheduled/* never hits /:id
import liveShoppingRouter from "./live-shopping";
router.use("/live",                      tc, liveShoppingRouter); // Live bag (co-host products) + "just bought"/gift activity
router.use("/live",                      tc, liveRouter);
import liveReplaysRouter from "./live-replays";
import liveTipsRouter from "./live-tips";
import walletPassesRouter from "./walletPasses";
router.use("/live-replays",              tc, liveReplaysRouter);
router.use("/live-tips",                 tc, liveTipsRouter);

// ─── Paid boosts, vacation mode, loyalty/rewards ──────────────────────────────
router.use("/boosts",                    tc, featureGate("boosts", { only: [{ method: "POST", path: "/" }] }), boostsRouter); // buying a boost: Growth+
router.use("/promotions",                promotionsRouter); // viewer-scoped Sponsored delivery; no tc
router.use("/featured-slots",            tc, featureGate("boosts", { only: [{ method: "POST", path: "/" }] }), featuredSlotsRouter); // /active is public; booking a slot: Growth+
router.use("/admin/promotions",          adminPromotionsRouter); // platform admins only
router.use("/ad-campaigns",              tc, adCampaignsRouter);
router.use("/iap-promotions",            tc, iapPromotionsRouter);
router.use("/ads",                       adsServeRouter); // buyer feed ad delivery; no tc
router.use("/meta-ads",                  tc, metaAdsRouter);
router.use("/seller/vacation",          tc, vacationRouter);
router.use("/link-preview",             linkPreviewRouter); // DM link cards (signed-in, SSRF-guarded)
router.use("/seller/quick-replies",     tc, quickRepliesRouter);
router.use("/seller/away-message",      tc, awayMessageRouter);
router.use("/seller/notification-prefs", tc, notificationPrefsRouter);
router.use("/loyalty",             loyaltyRouter); // buyer-scoped; no tc
router.use("/thread-cash",         threadCashRouter); // buyer-scoped; no tc
// Seller growth tools: tracked UTM links, link-in-bio, store pixels.
router.use("/growth",              tc, growthRouter);
// My Store: the product blocks on brandthread.app/@handle.
router.use("/store-blocks",        tc, storeBlocksRouter);
router.use("/seller/product-feed",  tc, sellerProductFeedRouter); // seller feed URL: view, create, regenerate
router.use("/gift-cards",          giftCardsRouter); // buyer + seller (own auth/permission checks); no tc

export default router;

import { Router } from "express";
import { requirePlan } from "../middlewares/requireAuth";
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
import sampleOrdersRouter from "./sample-orders";
import dropWalletRouter from "./drop-wallet";
import inventoryRouter from "./inventory";
import sellerHubRouter from "./seller-hub";
import pushRouter from "./push";
import aiRouter from "./ai";
// New: buyer-facing, public browsing, Stripe Connect, webhooks
import publicRouter from "./public";
import buyerRouter from "./buyer";
import connectRouter from "./connect";
import subscriptionRouter from "./subscription";
import webhooksRouter from "./webhooks";
import reviewsRouter from "./reviews";
import sellerProfileRouter from "./seller-profile";
import conversationsRouter from "./conversations";
import savedRouter from "./saved";
import cartDbRouter from "./cart-db";
import notificationsFeedRouter from "./notifications-feed";
import notificationPrefsRouter from "./notification-prefs";
import postsRouter from "./posts";
import reportsRouter from "./reports";
import socialRouter from "./social";
import referralsRouter from "./referrals";
import shippingRatesRouter from "./shipping-rates";
import disputesRouter from "./disputes";
import financeRouter from "./finance";
import taxesRouter from "./taxes";
import teamRouter from "./team";
import { requireRole, teamContext } from "../middlewares/requireRole";

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
import vacationRouter  from "./vacation";
import loyaltyRouter   from "./loyalty";
import callRouter      from "./call";

const router = Router();

// ─── Unauthenticated / special-body routes first ──────────────────────────────
router.use("/public",          publicRouter);
router.use("/webhooks",        webhooksRouter);
router.use("/support",         supportRouter);
router.use("/support-chat",    supportChatRouter);
// Specific seller sub-paths BEFORE the seller catch-all
router.use("/seller/export",   sellerExportRouter);

// ─── Authenticated seller + shared routes ─────────────────────────────────────
// tc (teamContext) is applied to every seller-scoped route so X-Store-Context
// is honoured consistently. resolveTeamContext is idempotent (cached on req),
// so routes that already mount it internally get a free no-op on the second call.
router.use("/call",            callRouter);
router.use("/healthz",         healthRouter);
router.use("/auth",            authRouter);
router.use("/products",        tc, productsRouter);
router.use("/orders",          tc, ordersRouter);
router.use("/customers",       tc, customersRouter);
router.use("/drops",           tc, dropsRouter);
router.use("/analytics",       tc, analyticsRouter);
router.use("/integrations",    tc, integrationsRouter);
// ─── Growth-plan-gated AI design routes ───────────────────────────────────────
router.use("/logo",            tc, requirePlan("growth"), logoRouter);
router.use("/mockup",          tc, requirePlan("growth"), mockupRouter);
router.use("/photography",     tc, requirePlan("growth"), photographyRouter);
router.use("/bg-removal",      tc, requirePlan("growth"), bgRemovalRouter);
router.use("/lifestyle",       tc, requirePlan("growth"), lifestyleRouter);
router.use("/techpack",        tc, techpackRouter);
// Specific manufacturer sub-paths BEFORE the catch-all manufacturersRouter
router.use("/manufacturers/public",          manufacturerPublicRouter);
router.use("/manufacturers/connect",         tc, manufacturerConnectRouter);
// Growth-plan-gated Manufacturer Hub
router.use("/manufacturers",   tc, requirePlan("growth"), manufacturersRouter);
router.use("/inventory",       tc, inventoryRouter);
router.use("/seller-hub",      tc, sellerHubRouter);
router.use("/push",            pushRouter);
router.use("/ai",              tc, aiRouter);

// ─── Buyer & Seller Connect / Subscription routes ─────────────────────────────
// Mount specific sub-paths before the catch-all /buyer router so they don't
// get swallowed by buyerRouter's lack of those handlers.
// Buyer routes are intentionally NOT wrapped with tc — buyer context must stay
// scoped to the actual buyer, not the team store owner.
router.use("/waitlist",                  tc, waitlistRouter);
router.use("/bundles",                   tc, bundlesRouter);
router.use("/buyer/products",            buyerProductsRouter);
router.use("/buyer/saved",               savedRouter);
router.use("/buyer/cart",                cartDbRouter);
router.use("/buyer/notifications",       notificationsFeedRouter);
router.use("/buyer",                     buyerRouter);
router.use("/conversations",             conversationsRouter);
router.use("/seller/connect",            requireRole("owner"), connectRouter);      // payouts: owner only; requireRole resolves tc internally
router.use("/seller/subscription",       subscriptionRouter); // router applies manager reads and owner mutations after team context
router.use("/seller/verification",       tc, sellerVerificationRouter);
router.use("/seller",                    tc, sellerProfileRouter);
router.use("/reviews",                   tc, reviewsRouter);
router.use("/posts",                     tc, postsRouter);
router.use("/reports",                   reportsRouter);
router.use("/social",                    socialRouter);
router.use("/referrals",                 referralsRouter);
router.use("/shipping-rates",            tc, shippingRatesRouter);
router.use("/discount-codes",            tc, discountCodesRouter);
router.use("/returns",                   tc, returnsRouter);
router.use("/sample-orders",             tc, sampleOrdersRouter);
router.use("/drop-wallets",              tc, dropWalletRouter);
router.use("/disputes",                  tc, disputesRouter);
router.use("/finance",                   financeRouter); // router applies manager reads and owner mutations after team context
router.use("/taxes",                     tc, taxesRouter);
router.use("/team",                      teamRouter);
router.use("/store/ai",                  tc, storeAiRouter);
router.use("/store",                     tc, storeRouter);

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
router.use("/live",                      tc, liveRouter);

// ─── Paid boosts, vacation mode, loyalty/rewards ──────────────────────────────
router.use("/boosts",         tc, boostsRouter);
router.use("/seller/vacation",          tc, vacationRouter);
router.use("/seller/notification-prefs", tc, notificationPrefsRouter);
router.use("/loyalty",             loyaltyRouter); // buyer-scoped; no tc

export default router;

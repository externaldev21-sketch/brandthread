import { Router } from "express";
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
import postsRouter from "./posts";
import reportsRouter from "./reports";
import socialRouter from "./social";
import referralsRouter from "./referrals";
import shippingRatesRouter from "./shipping-rates";
import disputesRouter from "./disputes";
import financeRouter from "./finance";
import taxesRouter from "./taxes";
import teamRouter from "./team";
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

const router = Router();

// ─── Unauthenticated / special-body routes first ──────────────────────────────
router.use("/public",          publicRouter);
router.use("/webhooks",        webhooksRouter);

// ─── Authenticated seller + shared routes ─────────────────────────────────────
router.use("/healthz",         healthRouter);
router.use("/auth",            authRouter);
router.use("/products",        productsRouter);
router.use("/orders",          ordersRouter);
router.use("/customers",       customersRouter);
router.use("/drops",           dropsRouter);
router.use("/analytics",       analyticsRouter);
router.use("/integrations",    integrationsRouter);
router.use("/logo",            logoRouter);
router.use("/mockup",          mockupRouter);
router.use("/photography",     photographyRouter);
router.use("/bg-removal",      bgRemovalRouter);
router.use("/lifestyle",       lifestyleRouter);
router.use("/techpack",        techpackRouter);
// Specific manufacturer sub-paths BEFORE the catch-all manufacturersRouter
router.use("/manufacturers/public",          manufacturerPublicRouter);
router.use("/manufacturers/connect",         manufacturerConnectRouter);
router.use("/manufacturers",                 manufacturersRouter);
router.use("/inventory",       inventoryRouter);
router.use("/seller-hub",      sellerHubRouter);
router.use("/push",            pushRouter);
router.use("/ai",              aiRouter);

// ─── Buyer & Seller Connect / Subscription routes ─────────────────────────────
// Mount specific sub-paths before the catch-all /buyer router so they don't
// get swallowed by buyerRouter's lack of those handlers.
router.use("/waitlist",                  waitlistRouter);
router.use("/bundles",                   bundlesRouter);
router.use("/buyer/products",            buyerProductsRouter);
router.use("/buyer/saved",               savedRouter);
router.use("/buyer/cart",                cartDbRouter);
router.use("/buyer/notifications",       notificationsFeedRouter);
router.use("/buyer",                     buyerRouter);
router.use("/conversations",             conversationsRouter);
router.use("/seller/connect",            connectRouter);
router.use("/seller/subscription",       subscriptionRouter);
router.use("/seller/verification",       sellerVerificationRouter);
router.use("/seller",                    sellerProfileRouter);
router.use("/reviews",                   reviewsRouter);
router.use("/posts",                     postsRouter);
router.use("/reports",                   reportsRouter);
router.use("/social",                    socialRouter);
router.use("/referrals",                 referralsRouter);
router.use("/shipping-rates",            shippingRatesRouter);
router.use("/discount-codes",            discountCodesRouter);
router.use("/returns",                   returnsRouter);
router.use("/sample-orders",             sampleOrdersRouter);
router.use("/drop-wallets",              dropWalletRouter);
router.use("/disputes",                  disputesRouter);
router.use("/finance",                   financeRouter);
router.use("/taxes",                     taxesRouter);
router.use("/team",                      teamRouter);
router.use("/store/ai",                  storeAiRouter);
router.use("/store",                     storeRouter);

// ─── New seller settings + buyer payments routes ──────────────────────────────
router.use("/seller/locations",          sellerLocationsRouter);
router.use("/seller/metafields",         sellerMetafieldsRouter);
router.use("/seller/settings",           sellerSettingsExtRouter);
router.use("/buyer/payment-methods",     buyerPaymentsRouter);

// ─── Live shopping ─────────────────────────────────────────────────────────────
import liveRouter from "./live";
router.use("/live",                      liveRouter);

export default router;

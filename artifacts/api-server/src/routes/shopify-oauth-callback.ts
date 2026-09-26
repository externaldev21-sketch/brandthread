/**
 * Shopify OAuth redirect target. Unauthenticated (Shopify redirects the
 * seller's browser here directly) — identity comes from the signed `state`
 * row we created in POST /api/shopify/connect/start, not from a Brandthread
 * session. Verifies Shopify's own `hmac` query param before trusting anything.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, shopifyConnections, shopifyOauthStates } from "@workspace/db";
import { verifyQueryHmac, exchangeCodeForToken } from "../lib/shopify/oauth";
import { normalizeShopDomain, isValidShopDomain, hasFulfillmentScopes } from "../lib/shopify/constants";
import { encryptSecret } from "../lib/shopifyCrypto";
import { logger } from "../lib/logger";

const router = Router();

function resultPage(status: "success" | "error", message: string): string {
  // A tiny static page: the mobile app opens the authorize URL in an
  // in-app browser and listens for this page's URL (or its own deep-link
  // redirect, see docs/integrations/shopify-tapstitch.md) to know when to
  // close it and refresh the connection screen.
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, sans-serif; text-align:center; padding-top:80px;">
<h2>${status === "success" ? "Shopify connected" : "Connection failed"}</h2>
<p>${message}</p>
<p>You can close this window and return to Brandthread.</p>
</body></html>`;
}

router.get("/", async (req, res) => {
  const query = req.query as Record<string, string>;
  const shopParam = query.shop;
  if (!shopParam || !verifyQueryHmac(query)) {
    res.status(401).send(resultPage("error", "This link could not be verified."));
    return;
  }

  const shopDomain = normalizeShopDomain(shopParam);
  if (!isValidShopDomain(shopDomain)) {
    res.status(400).send(resultPage("error", "Invalid shop domain."));
    return;
  }

  const state = query.state;
  const code = query.code;
  if (!state || !code) {
    res.status(400).send(resultPage("error", "Missing OAuth parameters."));
    return;
  }

  const [stateRow] = await db.select().from(shopifyOauthStates).where(eq(shopifyOauthStates.state, state)).limit(1);
  await db.delete(shopifyOauthStates).where(eq(shopifyOauthStates.state, state));
  if (!stateRow || stateRow.expiresAt < new Date() || stateRow.shopDomain !== shopDomain) {
    res.status(400).send(resultPage("error", "This connection link has expired. Please try again from the app."));
    return;
  }

  try {
    const { accessToken, scope } = await exchangeCodeForToken(shopDomain, code);
    const accessTokenEncrypted = encryptSecret(accessToken);

    const [existing] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, stateRow.ownerId)).limit(1);
    if (existing) {
      await db.update(shopifyConnections).set({
        shopDomain,
        accessTokenEncrypted,
        connectionType: "oauth",
        scopes: scope,
        status: "connected",
        lastError: null,
        disconnectedAt: null,
        updatedAt: new Date(),
        ...(stateRow.purpose === "fulfillment" && hasFulfillmentScopes(scope) ? { fulfillmentEnabled: true } : {}),
      }).where(eq(shopifyConnections.id, existing.id));
    } else {
      await db.insert(shopifyConnections).values({
        ownerId: stateRow.ownerId,
        shopDomain,
        accessTokenEncrypted,
        connectionType: "oauth",
        scopes: scope,
        fulfillmentEnabled: stateRow.purpose === "fulfillment" && hasFulfillmentScopes(scope),
      });
    }

    res.send(resultPage("success", `Your Shopify store ${shopDomain} is now connected to Brandthread.`));
  } catch (err) {
    logger.error({ err, shopDomain }, "Shopify OAuth callback failed");
    res.status(500).send(resultPage("error", "Something went wrong finishing the connection. Please try again."));
  }
});

export default router;

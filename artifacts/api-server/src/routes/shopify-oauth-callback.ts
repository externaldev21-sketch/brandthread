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
import { registerWebhooksForConnection } from "../lib/shopify/webhooks";
import { logger } from "../lib/logger";

const router = Router();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Where the in-app browser hands control back to the app (expo-web-browser auth session). */
export const SHOPIFY_APP_RETURN_URL = "brandthread://shopify-import";

function resultPage(status: "success" | "error", message: string): string {
  // The app opens the authorize URL in an auth session that closes as soon
  // as the browser lands on SHOPIFY_APP_RETURN_URL; the import screen then
  // re-reads the connection status. The button is the fallback for a browser
  // that doesn't follow the automatic redirect.
  const returnUrl = `${SHOPIFY_APP_RETURN_URL}?shopify=${status === "success" ? "connected" : "error"}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brandthread</title></head>
<body style="margin:0;background:#fff;color:#0a0a0a;font-family:Inter,-apple-system,system-ui,sans-serif;text-align:center;padding:80px 24px;">
<h2 style="font-weight:700;margin:0 0 12px;">${status === "success" ? "Shopify connected" : "Connection failed"}</h2>
<p style="color:#6b6b6b;line-height:1.5;margin:0 0 28px;">${message}</p>
<a href="${returnUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px;">Return to Brandthread</a>
<script>setTimeout(function(){ location.href = ${JSON.stringify(returnUrl)}; }, 600);</script>
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

    // Subscribe to fulfillment/cancel/uninstall events so tracking syncs back.
    const [saved] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, stateRow.ownerId)).limit(1);
    const webhookError = saved ? await registerWebhooksForConnection(saved) : null;
    res.send(resultPage(
      "success",
      `${escapeHtml(shopDomain)} is connected. Head back to Brandthread to import your products.${webhookError ? ` ${escapeHtml(webhookError)}` : ""}`,
    ));
  } catch (err) {
    logger.error({ err, shopDomain }, "Shopify OAuth callback failed");
    res.status(500).send(resultPage("error", "Something went wrong finishing the connection. Please try again."));
  }
});

export default router;

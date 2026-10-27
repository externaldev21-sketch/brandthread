/**
 * Whether the Brandthread Shopify app's credentials are present. The two
 * values come from the app's Settings page in Shopify's Dev Dashboard
 * (Client ID / Client secret); everything else has a safe default:
 *  - the redirect URL defaults to {web origin}/api/shopify/oauth/callback,
 *    which must be listed under the app version's "Redirect URLs";
 *  - access tokens are encrypted with SHOPIFY_TOKEN_ENCRYPTION_KEY when set,
 *    otherwise with a key derived from the client secret (lib/shopifyCrypto).
 * Until both are set, every Shopify connect route answers "not configured"
 * and the app explains that Shopify import is almost ready.
 */
import { getWebOrigin } from "../webOrigin";

export const SHOPIFY_OAUTH_CALLBACK_PATH = "/api/shopify/oauth/callback";

export function shopifyAppConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SHOPIFY_APP_API_KEY?.trim() && env.SHOPIFY_APP_API_SECRET?.trim());
}

export function shopifyRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHOPIFY_APP_REDIRECT_URI?.trim() || `${getWebOrigin()}${SHOPIFY_OAUTH_CALLBACK_PATH}`;
}

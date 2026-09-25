// Only the dashboard has a read-only seller preview. Other seller screens
// must not mount without a session, including screens linked by shortcuts.
// Leave auth and public routes accessible from the preview.
const PUBLIC_ROOT_ROUTES = new Set([
  'index', '(tabs)', 'splash', 'sign-in', 'forgot-password', 'onboarding',
  'thread-explainer', '(buyer)', 'seller-profile',
  'privacy', 'terms',
]);

export function requiresSellerPreviewSignIn(route: string, isTab: boolean): boolean {
  return isTab ? route !== 'index' : !PUBLIC_ROOT_ROUTES.has(route);
}
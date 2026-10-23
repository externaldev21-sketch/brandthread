export function isProductionDeployment(
  env?: Record<string, string | undefined>,
  headers?: Record<string, string | string[] | undefined>,
): boolean;
export function isPublicAppSealed(
  env?: Record<string, string | undefined>,
  headers?: Record<string, string | string[] | undefined>,
): boolean;
export function prelaunchAction(
  pathname: string,
  env?: Record<string, string | undefined>,
  headers?: Record<string, string | string[] | undefined>,
): 'cover' | 'legal' | 'redirect' | null;

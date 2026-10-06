import { pickRouteParam } from '@/lib/routeParamAliases';

/**
 * The post id Boost should open with, from `/boost?targetType=post&targetId=<id>`
 * (Post analytics "Boost post"). `?postId=` is accepted as an alias. Returns
 * undefined for any other target type.
 */
export function boostPreselectPostId(
  params: Record<string, string | string[] | undefined> | null | undefined,
): string | undefined {
  const type = pickRouteParam(params, 'targetType');
  if (type && type !== 'post') return undefined;
  return type ? pickRouteParam(params, 'targetId', 'postId') : pickRouteParam(params, 'postId');
}

/** The eligible boost target matching the requested post id, if any. */
export function findBoostTarget<T extends { id: string }>(
  targets: readonly T[],
  postId: string | undefined,
): T | null {
  if (!postId) return null;
  return targets.find((t) => t.id === postId) ?? null;
}

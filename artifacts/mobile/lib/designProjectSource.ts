/**
 * Picks a real, fetchable source image out of a seller's design projects for
 * the "Recent projects" picker on app/design-prompt-edit.tsx. Only URIs that
 * services/designService.ts's applyPromptEdit can actually read are returned
 * (it fetch()es the URI or passes a data URL through) — projects with no such
 * image are left out, so the picker never lists something Generate rejects.
 */
import type { DesignProject } from '@/services/designTypes';

export interface RecentProjectSource {
  id: string;
  name: string;
  uri: string;
}

const USABLE_URI = /^(https?:\/\/|file:\/\/|blob:|data:image\/(png|jpeg|webp);base64,)/i;

export function isUsableSourceUri(uri: unknown): uri is string {
  return typeof uri === 'string' && USABLE_URI.test(uri.trim());
}

export function projectSourceImage(project: DesignProject): string | null {
  if (isUsableSourceUri(project.thumbnail)) return project.thumbnail;
  if (isUsableSourceUri(project.canvas?.backgroundImageUri)) return project.canvas.backgroundImageUri;
  const imageLayers = (project.layers ?? [])
    .filter(l => l.visible && !l.isTemplate && l.data?.kind === 'image' && isUsableSourceUri(l.data.uri))
    .sort((a, b) => b.order - a.order);
  const top = imageLayers[0];
  return top && top.data.kind === 'image' ? top.data.uri : null;
}

export function recentProjectSources(projects: DesignProject[], limit = 6): RecentProjectSource[] {
  return [...projects]
    .filter(p => !p.deletedAt)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(p => {
      const uri = projectSourceImage(p);
      return uri ? { id: p.id, name: p.name || 'Untitled design', uri } : null;
    })
    .filter((p): p is RecentProjectSource => p !== null)
    .slice(0, limit);
}

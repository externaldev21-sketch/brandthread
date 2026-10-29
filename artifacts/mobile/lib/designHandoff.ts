/**
 * designHandoff.ts — carries the exported artwork from the Design Studio
 * canvas to the garment mockup ("Use design"), and from the gallery.
 *
 * The artwork is a transparent PNG (a data URI on web, a file URI on
 * native): far too large for a route param, so it rides in memory, keyed by
 * project id, for the life of the session.
 */

export interface DesignArtwork {
  projectId: string;
  /** Transparent PNG of the full canvas (or crop). */
  uri: string;
  width: number;
  height: number;
  createdAt: number;
}

const artworks = new Map<string, DesignArtwork>();

export function setDesignArtwork(art: DesignArtwork): void {
  artworks.set(art.projectId, art);
}

export function getDesignArtwork(projectId: string | undefined | null): DesignArtwork | null {
  if (!projectId) return null;
  return artworks.get(projectId) ?? null;
}

export function clearDesignArtwork(projectId: string): void {
  artworks.delete(projectId);
}

/**
 * "Use in a post": the flattened design (with its background) waiting for
 * /create-post?fromDesign=<projectId>, which opens straight on the editor
 * with it as the post's photo. Consumed once.
 */
const postMedia = new Map<string, DesignArtwork>();

export function setDesignPostMedia(art: DesignArtwork): void {
  postMedia.set(art.projectId, art);
}

export function takeDesignPostMedia(projectId: string | undefined | null): DesignArtwork | null {
  if (!projectId) return null;
  const art = postMedia.get(projectId) ?? null;
  postMedia.delete(projectId);
  return art;
}

/**
 * Version history → Restore, opened from the canvas: the restore goes back to
 * that same canvas, which reloads the restored project when it regains focus
 * (rather than stacking a second canvas over a stale one). Consumed once.
 */
const restored = new Set<string>();

export function markDesignRestored(projectId: string): void {
  restored.add(projectId);
}

export function takeDesignRestored(projectId: string | undefined | null): boolean {
  if (!projectId || !restored.has(projectId)) return false;
  restored.delete(projectId);
  return true;
}

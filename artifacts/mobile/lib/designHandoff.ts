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

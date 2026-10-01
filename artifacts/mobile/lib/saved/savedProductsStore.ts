/**
 * Saved-products cache — per-product "is this saved?" state shared by every
 * heart in the app (grid tiles, product detail, sheets).
 *
 * One batch load of the buyer's saved product ids (the existing
 * GET /api/buyer/saved list — no extra endpoint), then optimistic toggles that
 * roll back if the server call fails. Framework-free and dependency-injected
 * so the logic is unit-testable; hooks/useSavedProduct.ts binds it to React
 * and services/socialService.ts.
 */

export interface SavedProductDraft {
  productId: string;
  title: string;
  brand?: string;
  priceCents?: number;
}

export interface SavedProductsDeps {
  /** Returns the buyer's saved rows; only `type === 'product'` rows count. */
  fetchSaved: () => Promise<Array<{ type: string; targetId: string }>>;
  save: (draft: SavedProductDraft) => Promise<unknown>;
  remove: (productId: string) => Promise<unknown>;
}

export type ToggleResult =
  | { ok: true; saved: boolean }
  | { ok: false; saved: boolean; reason: 'signed-out' | 'error' | 'busy' };

type Listener = () => void;

export function createSavedProductsStore(deps: SavedProductsDeps) {
  let ids = new Set<string>();
  let loaded = false;
  let inflight: Promise<void> | null = null;
  const pending = new Set<string>();
  let signedIn = false;
  let currentKey: string | null = null;
  let generation = 0;
  const listeners = new Set<Listener>();

  const emit = () => listeners.forEach((l) => l());

  async function load(force = false): Promise<void> {
    if (!signedIn) return;
    if (loaded && !force) return;
    if (inflight) return inflight;
    const gen = generation;
    const run = (async () => {
      try {
        const rows = await deps.fetchSaved();
        if (gen !== generation) return;
        const next = new Set<string>();
        for (const r of rows) if (r.type === 'product') next.add(r.targetId);
        // A toggle in flight is newer than this snapshot — keep its optimistic value.
        for (const id of pending) {
          if (ids.has(id)) next.add(id); else next.delete(id);
        }
        ids = next;
        loaded = true;
        emit();
      } catch {
        // Hearts simply render unsaved until the next attempt.
      } finally {
        if (gen === generation) inflight = null;
      }
    })();
    inflight = run;
    return run;
  }

  return {
    subscribe(l: Listener): () => void {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    has: (productId: string) => ids.has(productId),
    isLoaded: () => loaded,
    isSignedIn: () => signedIn,
    size: () => ids.size,
    load,
    /** Re-read the server list (e.g. after another screen changed saves). */
    refresh: (): Promise<void> => (pending.size > 0 ? Promise.resolve() : load(true)),
    /** Auth state from Clerk. Signing out or switching accounts clears the cache. */
    setSignedIn(next: boolean, userKey?: string | null): void {
      const key = next ? (userKey ?? 'user') : null;
      if (next === signedIn && key === currentKey) return;
      currentKey = key;
      signedIn = next;
      generation += 1;
      ids = new Set();
      loaded = false;
      inflight = null;
      pending.clear();
      emit();
      if (next) void load();
    },
    /** Mark saved without a server call (the collection sheet already saved it). */
    markSaved(productId: string): void {
      if (ids.has(productId)) return;
      ids = new Set(ids).add(productId);
      emit();
    },
    async toggle(draft: SavedProductDraft): Promise<ToggleResult> {
      const { productId } = draft;
      if (!signedIn) return { ok: false, saved: false, reason: 'signed-out' };
      if (pending.has(productId)) return { ok: false, saved: ids.has(productId), reason: 'busy' };
      const wasSaved = ids.has(productId);
      const next = new Set(ids);
      if (wasSaved) next.delete(productId); else next.add(productId);
      ids = next;
      pending.add(productId);
      const gen = generation;
      emit();
      try {
        if (wasSaved) await deps.remove(productId); else await deps.save(draft);
        return { ok: true, saved: !wasSaved };
      } catch {
        if (gen === generation) {
          const back = new Set(ids);
          if (wasSaved) back.add(productId); else back.delete(productId);
          ids = back;
        }
        return { ok: false, saved: wasSaved, reason: 'error' };
      } finally {
        if (gen === generation) {
          pending.delete(productId);
          emit();
        }
      }
    },
  };
}

export type SavedProductsStore = ReturnType<typeof createSavedProductsStore>;

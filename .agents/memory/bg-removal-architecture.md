---
name: Background Removal Architecture
description: End-to-end architecture for the Design Studio Remove Background feature including object storage, persistence, and all mobile integrations.
---

## Flow
1. Mobile picks image with `base64:true` from ImagePicker (returns b64 already — no readAsText needed)
2. Mobile posts `data:{mime};base64,{b64}` to `/api/bg-removal/remove` via **fetch + Clerk Bearer token** (not useApi — uses AbortController for cancel)
3. API writes temp file, calls OpenAI `editImages` with `{ background: "transparent" }`, saves PNG to GCS, returns `{ b64_json, storageKey, size, mime, createdAt, id }`
4. Mobile writes b64 to `Paths.document/bg-results/{id}.png` via `new File(...).write(b64, { encoding: 'base64' })`
5. Mobile stores **local file path** (not b64) in AsyncStorage at `bt:bg-removal:results:v1`
6. On reload: display from local path directly via `<Image source={{ uri: localPath }}>`

## Key Decisions
- **Why local file cache + GCS**: local path survives app restarts, GCS is backup; `<Image>` component doesn't support auth headers so remote URL serving requires download-first
- **Why direct fetch (not useApi)**: Need AbortController for cancel support; useApi wrapper doesn't expose signal
- **bgRemovalService.ts** — `saveResult`, `getResults`, `deleteResult`, `isLocalFileAvailable`, `restoreLocalFile`, `clearAllResults`
- Max 20 results stored; `isLocalFileAvailable` filters stale entries on load
- **Export PNG**: use `result.localPath` directly with `MediaLibrary.saveToLibraryAsync()` — no copy needed

## GCS Path
- Bucket: `DEFAULT_OBJECT_STORAGE_BUCKET_ID`
- Object: `{prefix}/bg-removal/{userId}/{uuid}.png` where prefix comes from `PRIVATE_OBJECT_DIR`
- Serving route: `GET /api/bg-removal/results/*storageKey` (not `*` — must be named for path-to-regexp v8)

## path-to-regexp v8 Gotcha
Wildcard routes must use a **named wildcard**: `router.get("/results/*storageKey", ...)` — plain `*` throws `PathError: Missing parameter name`.

## ProductMedia Required Fields
`ProductMedia` requires `isCover: boolean`, `sortOrder: number`, `createdAt: string` in addition to `id`, `type`, `uri`.

## Integration Actions
- Export PNG: `MediaLibrary.saveToLibraryAsync(localPath)`
- Brand Assets: `createBrandAsset({ type: 'photo', uri: localPath, tags: ['bg-removed', 'transparent'] })`
- Design Studio: same as above but `type: 'graphic'`, tag `design-layer`, then navigate to `/design-brand-assets`
- Add to Product: show Modal FlatList from `getProducts()`, call `updateProduct(id, { media: [...existing, newMedia] })`
- Content Creator: save as brand asset + `Alert` pointing user to asset picker + navigate `/create-post`
- Store Builder: save as brand asset with tag `store-asset` + navigate `/store-builder`

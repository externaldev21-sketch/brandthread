/**
 * Hands a captured mockup image from /design-mockup-preview to the product
 * screens it opens ("Add to product"):
 *   - /add-product?mockupProjectId=<id>            → new product starts with the mockup photo
 *   - /(tabs)/products?pickForMockup=1&projectId=<id> → tapping a product attaches the mockup
 *
 * The image is a captured data/file URI, far too large for a route param, so
 * it is held in memory for the hand-off and only the project id travels in
 * the URL.
 */

export type PendingMockup = {
  projectId: string;
  /** data: or file: URI of the flattened mockup PNG. */
  uri: string;
  name?: string;
};

let pending: PendingMockup | null = null;

export function setPendingMockup(m: PendingMockup | null): void {
  pending = m && m.uri ? m : null;
}

/** The pending mockup for this project (or any, when no id is given), without consuming it. */
export function peekPendingMockup(projectId?: string | null): PendingMockup | null {
  if (!pending) return null;
  if (projectId && pending.projectId !== projectId) return null;
  return pending;
}

/** Returns and clears the pending mockup for this project. */
export function takePendingMockup(projectId?: string | null): PendingMockup | null {
  const m = peekPendingMockup(projectId);
  if (m) pending = null;
  return m;
}

type ProductImagesApi = {
  products: {
    get: (id: string) => Promise<unknown>;
    update: (id: string, body: unknown) => Promise<unknown>;
    uploadImage: (image: { uri: string; mimeType?: string | null }) => Promise<{ objectPath: string }>;
  };
};

/** Uploads the mockup through the product photo pipeline; returns its object path. */
export async function uploadMockupImage(api: ProductImagesApi, mockupUri: string): Promise<string> {
  const uploaded = await api.products.uploadImage({ uri: mockupUri, mimeType: 'image/png' });
  if (!uploaded?.objectPath) throw new Error('Upload failed');
  return uploaded.objectPath;
}

/** Appends an uploaded image to a server product's images (PUT /api/products/:id). */
export async function appendProductImage(
  api: ProductImagesApi,
  productId: string,
  objectPath: string,
): Promise<string[]> {
  const product = (await api.products.get(productId)) as { images?: unknown } | null;
  const current = Array.isArray(product?.images)
    ? (product!.images as unknown[]).filter((u): u is string => typeof u === 'string' && !!u)
    : [];
  const images = [...current, objectPath];
  await api.products.update(productId, { images });
  return images;
}

type ListedProduct = { id: string; media?: Array<{ sortOrder?: number }> | null };

/**
 * Products-tab "pick a product for this mockup": uploads the mockup, appends
 * it to the server product's images (when the product exists there) and to
 * the listed product's media so the catalog shows it immediately. A 404 from
 * the server only means the product lives in the local catalog store, so the
 * local patch still runs.
 */
export async function attachMockupToListedProduct(
  deps: {
    api: ProductImagesApi;
    updateLocal: (id: string, patch: { media: any[] }) => Promise<unknown>;
    now?: () => Date;
  },
  product: ListedProduct,
  mockupUri: string,
): Promise<void> {
  const objectPath = await uploadMockupImage(deps.api, mockupUri);
  try {
    await appendProductImage(deps.api, product.id, objectPath);
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status !== 404) throw err;
  }
  const media = Array.isArray(product.media) ? product.media : [];
  const createdAt = (deps.now ? deps.now() : new Date()).toISOString();
  await deps.updateLocal(product.id, {
    media: [
      ...media,
      {
        id: `mockup-${createdAt}`,
        type: 'image',
        uri: objectPath,
        isCover: media.length === 0,
        sortOrder: media.length,
        createdAt,
      },
    ],
  });
}

/**
 * In-memory stand-in for /api/store-blocks, used ONLY in the dev web seller
 * preview so the signed-out preview never calls a protected endpoint.
 * Fresh preview = an empty store; `&demo=1` = the preview catalog as blocks
 * (pre-made cards, one pre-order, one Button-style row).
 */
import { isPreviewDemoMode } from './devPreview';
import {
  defaultButtonText, shipByLabel, toDay, type BlockKind, type CatalogProduct, type StoreBlock,
} from './storeBlocks';

const DAY = 86_400_000;
let blocks: StoreBlock[] | null = null;
let catalogRows: CatalogProduct[] | null = null;
// Which dataset the state was built for: demo is URL-only (lib/devPreview).
let builtFor: boolean | null = null;
let n = 1;

type Fixture = { id: string; name: string; description: string; image: string | null; priceCents: number; stock: number };

async function fixtures(): Promise<Fixture[]> {
  if (!isPreviewDemoMode()) return [];
  // Loaded lazily: the preview catalog pulls in bundled images (expo-asset).
  const { getPreviewSellerProducts } = await import('./previewSellerProducts');
  return getPreviewSellerProducts().map((p) => ({
    id: p.id, name: p.name, description: p.description ?? '', image: p.media?.[0]?.uri ?? null,
    priceCents: p.pricing?.priceCents ?? 0, stock: p.inventory?.availableStock ?? 0,
  }));
}

function block(f: Fixture, i: number, over: Partial<StoreBlock> = {}): StoreBlock {
  const kind: BlockKind = over.kind ?? 'premade';
  return {
    id: `pv-block-${f.id}`, productId: f.id, kind, style: 'callout', position: i, visible: true, status: 'published',
    title: f.name, subtitle: '', buttonText: '', buttonLabel: defaultButtonText(kind),
    thumbImage: f.image, thumbImageRef: f.image, checkoutImage: null, checkoutImageRef: null, description: '',
    product: { name: f.name, status: 'active', description: f.description, image: f.image, moderationLocked: false },
    priceCents: f.priceCents, compareAtPriceCents: null, stock: f.stock, variantCount: 1,
    shipBy: null, shipByLabel: '', preorderCap: null, preorderSold: null, open: true,
    ...over,
  };
}

async function state(): Promise<{ blocks: StoreBlock[]; catalog: CatalogProduct[] }> {
  const demo = isPreviewDemoMode();
  if (builtFor !== demo) { blocks = null; catalogRows = null; builtFor = demo; }
  if (!blocks || !catalogRows) {
    const all = await fixtures();
    const ship = toDay(new Date(Date.now() + 38 * DAY));
    const [tee, hoodie, coat, denim, sweats] = all;
    blocks = all.length ? [
      block(coat, 0, {
        kind: 'preorder', buttonLabel: 'Pre-order', subtitle: 'Double-faced wool. Made to order in small runs.',
        priceCents: 19800, compareAtPriceCents: 24000, shipBy: ship, shipByLabel: shipByLabel(ship), preorderCap: 40, preorderSold: 12, stock: 28,
      }),
      block(tee, 1, { subtitle: '240gsm cotton, garment-dyed.' }),
      block(hoodie, 2, { subtitle: 'Brushed fleece, boxy fit.' }),
      block(denim, 3, { style: 'button' }),
    ] : [];
    catalogRows = sweats ? [{ id: sweats.id, name: sweats.name, status: 'active', isPreOrder: false, image: sweats.image, priceCents: sweats.priceCents, stock: sweats.stock }] : [];
  }
  return { blocks, catalog: catalogRows };
}

const find = async (id: string) => {
  const s = await state();
  const b = s.blocks.find((x) => x.id === id);
  if (!b) throw new Error('Not found');
  return b;
};
const replace = async (b: StoreBlock) => {
  const s = await state();
  blocks = s.blocks.map((x) => (x.id === b.id ? b : x));
  return b;
};

export const previewStoreBlocks = {
  async list() { return [...(await state()).blocks]; },
  async catalog() { return [...(await state()).catalog]; },
  async add(productId: string): Promise<StoreBlock> {
    const s = await state();
    const p = s.catalog.find((c) => c.id === productId);
    if (!p) throw new Error('Product not found');
    const b = block({ id: p.id, name: p.name, description: '', image: p.image, priceCents: p.priceCents ?? 0, stock: p.stock }, s.blocks.length, { status: 'draft' });
    blocks = [...s.blocks, b];
    catalogRows = s.catalog.filter((c) => c.id !== productId);
    return b;
  },
  async create(input: { kind: BlockKind; title: string; description: string; imagePath: string | null; priceCents: number; compareAtPriceCents: number | null; stock: number; shipBy: string | null }) {
    const s = await state();
    const id = `pv-new-${n++}`;
    const b = block({ id, name: input.title, description: input.description, image: input.imagePath, priceCents: input.priceCents, stock: input.stock }, s.blocks.length, {
      kind: input.kind, status: 'draft', compareAtPriceCents: input.compareAtPriceCents,
      ...(input.kind === 'preorder' ? { shipBy: input.shipBy, shipByLabel: shipByLabel(input.shipBy), stock: 0 } : {}),
    });
    blocks = [...s.blocks, b];
    return b;
  },
  async patch(id: string, p: Record<string, unknown>): Promise<StoreBlock> {
    const b = await find(id);
    const next: StoreBlock = { ...b };
    for (const k of ['style', 'title', 'subtitle', 'buttonText', 'description', 'visible', 'priceCents', 'compareAtPriceCents', 'preorderCap'] as const) {
      if (k in p) (next as unknown as Record<string, unknown>)[k] = p[k];
    }
    if ('thumbImage' in p) { next.thumbImage = p.thumbImage as string | null; next.thumbImageRef = next.thumbImage; }
    if ('checkoutImage' in p) { next.checkoutImage = p.checkoutImage as string | null; next.checkoutImageRef = next.checkoutImage; }
    if ('shipBy' in p) { next.shipBy = p.shipBy as string; next.shipByLabel = shipByLabel(next.shipBy); }
    next.buttonLabel = next.buttonText || defaultButtonText(next.kind);
    if (next.kind === 'preorder' && next.status === 'published' && 'preorderCap' in p) {
      next.stock = Math.max(0, (next.preorderCap ?? 100_000) - (next.preorderSold ?? 0));
    }
    return replace(next);
  },
  async publish(id: string): Promise<StoreBlock> {
    const b = await find(id);
    const stock = b.kind === 'preorder' ? Math.max(0, (b.preorderCap ?? 100_000) - (b.preorderSold ?? 0)) : b.stock;
    return replace({ ...b, status: 'published', visible: true, stock, preorderSold: b.kind === 'preorder' ? b.preorderSold ?? 0 : null, product: { ...b.product, status: 'active' } });
  },
  async remove(id: string) {
    const s = await state();
    const b = s.blocks.find((x) => x.id === id);
    blocks = s.blocks.filter((x) => x.id !== id);
    if (b) catalogRows = [...s.catalog, { id: b.productId, name: b.product.name, status: b.product.status, isPreOrder: b.kind === 'preorder', image: b.product.image, priceCents: b.priceCents, stock: b.stock }];
  },
  async reorder(ids: string[]) {
    const s = await state();
    blocks = ids.map((id, i) => ({ ...s.blocks.find((b) => b.id === id)!, position: i }));
    return [...blocks];
  },
};

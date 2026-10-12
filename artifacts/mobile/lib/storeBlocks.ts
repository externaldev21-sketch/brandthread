/**
 * Store blocks (Stan Store's "products") — the product cards on the seller's
 * store. Two kinds only: pre-made (in stock, ships now) and pre-order (paid
 * now, ships by a date, optional cap). Mirrors the server's rules in
 * artifacts/api-server/src/lib/growth/storeBlocks.ts.
 *
 * The editor works on a BlockDraft (what the fields show) and turns it into
 * an API patch; the live preview reads the same draft.
 */
export type BlockKind = 'premade' | 'preorder';
export type BlockStyle = 'callout' | 'button';

export interface StoreBlock {
  id: string;
  productId: string;
  kind: BlockKind;
  style: BlockStyle;
  position: number;
  visible: boolean;
  status: 'draft' | 'published';
  title: string;
  subtitle: string;
  buttonText: string;
  buttonLabel: string;
  thumbImage: string | null;
  thumbImageRef: string | null;
  checkoutImage: string | null;
  checkoutImageRef: string | null;
  description: string;
  product: { name: string; status: string; description: string; image: string | null; moderationLocked: boolean };
  priceCents: number | null;
  compareAtPriceCents: number | null;
  stock: number;
  variantCount: number;
  shipBy: string | null;
  shipByLabel: string;
  preorderCap: number | null;
  preorderSold: number | null;
  open: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  status: string;
  isPreOrder: boolean;
  image: string | null;
  priceCents: number | null;
  stock: number;
}

export const BLOCK_LIMITS = { title: 80, subtitle: 120, buttonText: 24, description: 2000, preorderCap: 10_000 } as const;
/** Pre-orders must ship within this many days (server: lib/preorderTerms PREORDER_REFUND_WINDOW_DAYS). */
export const PREORDER_WINDOW_DAYS = 60;

export const KIND_LABEL: Record<BlockKind, string> = { premade: 'Pre-made', preorder: 'Pre-order' };

export function defaultButtonText(kind: BlockKind): string {
  return kind === 'preorder' ? 'Pre-order' : 'Buy now';
}

/** "$48" / "$48.50". */
export function priceLabel(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '';
  const v = Math.max(0, Math.round(cents)) / 100;
  return `$${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2)}`;
}

const DAY = 86_400_000;
const utcDay = (d: Date) => Math.floor(d.getTime() / DAY);

/** "2026-11-20" → Date at UTC midnight, or null. */
export function parseDay(day: string | null | undefined): Date | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const toDay = (d: Date) => d.toISOString().slice(0, 10);

/** "Ships by Nov 20" (the year only when it isn't this year). */
export function shipByLabel(day: string | null | undefined, now = new Date()): string {
  const d = parseDay(day?.slice(0, 10));
  if (!d) return '';
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return `Ships by ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })}`;
}

/** First and last ship-by days a pre-order can pick (tomorrow … +60 days). */
export function shipByRange(now = new Date()): { min: string; max: string } {
  const today = utcDay(now);
  return { min: toDay(new Date((today + 1) * DAY)), max: toDay(new Date((today + PREORDER_WINDOW_DAYS) * DAY)) };
}

/** "48" / "48.5" / "$1,200.00" → cents, or null. */
export function parsePrice(text: string): number | null {
  const v = text.replace(/[$,\s]/g, '');
  if (!/^\d{1,6}(\.\d{0,2})?$/.test(v)) return null;
  return Math.round(parseFloat(v) * 100);
}

export const centsToInput = (cents: number | null | undefined) =>
  cents == null ? '' : (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

export interface BlockDraft {
  kind: BlockKind;
  style: BlockStyle;
  title: string;
  subtitle: string;
  buttonText: string;
  /** What to show: a signed URL or a local file just picked. */
  thumbImage: string | null;
  /** True when thumbImage is a local file that still needs uploading. */
  thumbLocal: boolean;
  checkoutImage: string | null;
  checkoutLocal: boolean;
  description: string;
  /** The full price. */
  price: string;
  discountOn: boolean;
  /** The lower price buyers pay while the discount is on. */
  discountPrice: string;
  /** Units in stock — only asked for a product made right here. */
  stock: string;
  shipBy: string | null;
  capOn: boolean;
  cap: string;
}

export function emptyDraft(kind: BlockKind): BlockDraft {
  return {
    kind, style: 'callout', title: '', subtitle: '', buttonText: '', thumbImage: null, thumbLocal: false,
    checkoutImage: null, checkoutLocal: false, description: '', price: '', discountOn: false, discountPrice: '',
    stock: kind === 'premade' ? '1' : '', shipBy: null, capOn: false, cap: '',
  };
}

export function draftFromBlock(b: StoreBlock): BlockDraft {
  const discounted = b.compareAtPriceCents != null && b.priceCents != null && b.compareAtPriceCents > b.priceCents;
  return {
    kind: b.kind,
    style: b.style,
    title: b.title || b.product.name,
    subtitle: b.subtitle,
    buttonText: b.buttonText,
    thumbImage: b.thumbImage ?? b.product.image,
    thumbLocal: false,
    checkoutImage: b.checkoutImage,
    checkoutLocal: false,
    description: b.description || b.product.description,
    price: centsToInput(discounted ? b.compareAtPriceCents : b.priceCents),
    discountOn: discounted,
    discountPrice: discounted ? centsToInput(b.priceCents) : '',
    stock: String(b.stock),
    shipBy: b.shipBy ? b.shipBy.slice(0, 10) : null,
    capOn: b.preorderCap != null,
    cap: b.preorderCap != null ? String(b.preorderCap) : '',
  };
}

/** What buyers pay and the struck-through original, from the price fields. */
export function draftPricing(d: BlockDraft): { priceCents: number | null; compareAtPriceCents: number | null } {
  const full = parsePrice(d.price);
  const sale = d.discountOn ? parsePrice(d.discountPrice) : null;
  if (full != null && sale != null && sale < full) return { priceCents: sale, compareAtPriceCents: full };
  return { priceCents: full, compareAtPriceCents: null };
}

export type DraftStep = 'thumbnail' | 'checkout' | 'publish';
export interface DraftProblem { step: DraftStep; field: keyof BlockDraft; message: string }

/** Everything that stops a draft from going live, in step order. */
export function draftProblems(d: BlockDraft, opts: { isNew: boolean; now?: Date }): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!d.title.trim()) out.push({ step: 'thumbnail', field: 'title', message: 'Add a title' });
  const full = parsePrice(d.price);
  if (full == null || full < 100) out.push({ step: 'thumbnail', field: 'price', message: 'Price must be at least $1' });
  if (d.discountOn) {
    const sale = parsePrice(d.discountPrice);
    if (sale == null || sale < 100) out.push({ step: 'checkout', field: 'discountPrice', message: 'Discount price must be at least $1' });
    else if (full != null && sale >= full) out.push({ step: 'checkout', field: 'discountPrice', message: 'Discount price must be lower than the price' });
  }
  if (opts.isNew && d.kind === 'premade') {
    const n = Number(d.stock);
    if (!/^\d{1,5}$/.test(d.stock) || n < 1) out.push({ step: 'checkout', field: 'stock', message: 'Add how many you have' });
  }
  if (d.kind === 'preorder') {
    const range = shipByRange(opts.now);
    if (!d.shipBy) out.push({ step: 'checkout', field: 'shipBy', message: 'Pick a ship date' });
    else if (d.shipBy < range.min || d.shipBy > range.max) out.push({ step: 'checkout', field: 'shipBy', message: `Pick a date in the next ${PREORDER_WINDOW_DAYS} days` });
    if (d.capOn) {
      const n = Number(d.cap);
      if (!/^\d{1,5}$/.test(d.cap) || n < 1 || n > BLOCK_LIMITS.preorderCap) out.push({ step: 'checkout', field: 'cap', message: 'Enter how many pre-orders to take' });
    }
  }
  return out;
}

/** The PATCH body for a draft: only what changed from the saved block. */
export function draftPatch(d: BlockDraft, saved: StoreBlock | null, refs: { thumbImage?: string | null; checkoutImage?: string | null } = {}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown, was: unknown) => { if (!saved || value !== was) patch[key] = value; };
  set('style', d.style, saved?.style);
  set('title', d.title.trim(), saved?.title);
  set('subtitle', d.subtitle.trim(), saved?.subtitle);
  set('buttonText', d.buttonText.trim(), saved?.buttonText);
  set('description', d.description.trim(), saved?.description || saved?.product.description);
  if (refs.thumbImage !== undefined) patch.thumbImage = refs.thumbImage;
  if (refs.checkoutImage !== undefined) patch.checkoutImage = refs.checkoutImage;
  const { priceCents, compareAtPriceCents } = draftPricing(d);
  if (priceCents != null) {
    set('priceCents', priceCents, saved?.priceCents);
    if (!saved || priceCents !== saved.priceCents || compareAtPriceCents !== saved.compareAtPriceCents) patch.compareAtPriceCents = compareAtPriceCents;
  }
  if (d.kind === 'preorder') {
    if (d.shipBy) set('shipBy', d.shipBy, saved?.shipBy?.slice(0, 10));
    set('preorderCap', d.capOn && /^\d+$/.test(d.cap) ? Number(d.cap) : null, saved?.preorderCap ?? null);
  }
  return patch;
}

/** The card as the store shows it, from a draft (live preview). */
export function draftCard(d: BlockDraft, opts: { soldOut?: boolean } = {}) {
  const { priceCents, compareAtPriceCents } = draftPricing(d);
  return {
    style: d.style,
    kind: d.kind,
    title: d.title.trim() || KIND_LABEL[d.kind],
    subtitle: d.subtitle.trim(),
    image: d.thumbImage,
    priceLabel: priceLabel(priceCents),
    compareAtLabel: priceLabel(compareAtPriceCents),
    shipByLabel: d.kind === 'preorder' ? shipByLabel(d.shipBy) : '',
    buttonText: d.buttonText.trim() || defaultButtonText(d.kind),
    unavailableLabel: opts.soldOut ? 'Sold out' : null,
  };
}

/** The card as the store shows it, from a saved block. */
export function blockCard(b: StoreBlock) {
  return {
    style: b.style,
    kind: b.kind,
    title: b.title || b.product.name,
    subtitle: b.subtitle,
    image: b.thumbImage ?? b.product.image,
    priceLabel: priceLabel(b.priceCents),
    compareAtLabel: priceLabel(b.compareAtPriceCents),
    shipByLabel: b.kind === 'preorder' ? b.shipByLabel || shipByLabel(b.shipBy) : '',
    buttonText: b.buttonLabel || defaultButtonText(b.kind),
    unavailableLabel: !b.open ? 'Pre-orders closed' : b.stock <= 0 ? 'Sold out' : null,
  };
}

export type StoreCard = ReturnType<typeof blockCard>;

/** Blocks the store shows, in order. */
export const liveBlocks = (blocks: StoreBlock[]) => blocks.filter((b) => b.status === 'published' && b.visible);

/** Move one item (drag-to-reorder). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Index a dragged row lands on, from where it started and how far it moved. */
export function dropIndex(from: number, dy: number, step: number, count: number): number {
  'worklet';
  return Math.max(0, Math.min(count - 1, Math.round((from * step + dy) / step)));
}

/** The days of a month as weeks starting Sunday (null = padding), UTC. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(toDay(new Date(Date.UTC(year, month, d))));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

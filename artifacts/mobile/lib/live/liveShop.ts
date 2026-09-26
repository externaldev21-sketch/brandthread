/**
 * Builds the existing ShopProductSheet selection for a product sold in a
 * live stream, so "Buy" opens the same Shop sheet → cart → checkout flow the
 * Threads feed uses. Pure (types only) so it is unit-testable.
 */
import type { BuyerProduct } from '@/services/cartTypes';
import type { ShopSheetSelection } from '@/components/ShopProductSheet';
import type { LiveProduct, LiveStream } from './types';

/** Preview products never hit the API — the sheet renders this instead. */
export function previewLiveBuyerProduct(stream: LiveStream, product: LiveProduct): BuyerProduct {
  const optionId = `${product.productId}-size`;
  const sizes = (product.sizes?.length ? product.sizes : ['XS', 'S', 'M', 'L']).map(label => ({
    id: `${optionId}-${label.toLowerCase()}`,
    label,
  }));
  const compare = product.compareAtPriceCents ?? undefined;
  return {
    id: product.productId,
    sellerId: stream.host.id,
    sellerName: stream.host.name,
    sellerHandle: stream.host.handle,
    name: product.name,
    description: `Selling live now on ${stream.host.name}'s stream — ${stream.title}.`,
    priceCents: product.priceCents,
    compareAtPriceCents: compare ?? undefined,
    imageUris: product.imageUri ? [product.imageUri] : [],
    category: 'High Fashion',
    isPreOrder: false,
    cancellationPolicy: 'Preview item — no real order will be placed.',
    refundPolicy: 'Preview item — no payment will be collected.',
    options: [{ id: optionId, name: 'Size', values: sizes }],
    variants: sizes.map((size, index) => ({
      id: `${product.productId}-variant-${size.label.toLowerCase()}`,
      title: size.label,
      optionValues: [{ optionId, valueId: size.id }],
      priceCents: product.priceCents,
      compareAtPriceCents: compare ?? undefined,
      inventoryQuantity: 2 + index * 2,
      isAvailable: true,
      imageUri: product.imageUri ?? undefined,
    })),
    isActive: true,
    tags: ['live', 'preview'],
  };
}

export function liveShopSelection(stream: LiveStream, productId: string, isPreview: boolean): ShopSheetSelection | null {
  const index = stream.products.findIndex(p => p.productId === productId);
  if (index < 0) return null;
  const product = stream.products[index];
  const toTag = (p: LiveProduct) => ({ productId: p.productId, productName: p.name, priceCents: p.priceCents });
  // The sheet can only render a preview product for the tag it was given
  // (switching to another tag would fetch it from the API), so preview mode
  // opens on just the tapped product; real streams get the full switcher.
  return {
    postId: `live-${stream.id}`,
    postSellerId: stream.host.id,
    tags: isPreview ? [toTag(product)] : stream.products.map(toTag),
    activeTagIndex: isPreview ? 0 : index,
    previewProduct: isPreview ? previewLiveBuyerProduct(stream, product) : undefined,
  };
}

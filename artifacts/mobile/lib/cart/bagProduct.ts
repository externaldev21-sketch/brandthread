import type { BuyerProduct, CartItem } from '@/services/cartTypes';

export function bagCanChooseOptions(item: CartItem, live?: BuyerProduct | null): boolean {
  const product = live?.id === item.productId ? live : item.productSnapshot?.id === item.productId ? item.productSnapshot : undefined;
  // Unknown metadata is not evidence that a product only has one variant.
  return product ? product.variants.length > 1 : !!item.variantTitle && item.variantTitle !== 'Default';
}

/** A cached bag line must remain readable even when its catalog request fails. */
export function bagProduct(item: CartItem, live?: BuyerProduct | null): BuyerProduct {
  if (live?.id === item.productId) return live;
  if (item.productSnapshot?.id === item.productId) return item.productSnapshot;
  return {
    id: item.productId,
    sellerId: item.sellerId,
    sellerName: item.sellerName,
    sellerHandle: item.sellerHandle,
    name: item.productName,
    description: '',
    priceCents: item.priceCents,
    compareAtPriceCents: item.compareAtPriceCents,
    imageUris: item.imageUri ? [item.imageUri] : [],
    category: '',
    isPreOrder: item.isPreOrder,
    cancellationPolicy: '',
    refundPolicy: '',
    isActive: item.isAvailable,
    tags: [],
    options: [],
    // Never invent alternative sizes or stock for a legacy/offline line.
    variants: [{
      id: item.variantId,
      title: item.variantTitle,
      optionValues: [],
      priceCents: item.priceCents,
      compareAtPriceCents: item.compareAtPriceCents,
      inventoryQuantity: item.maxQuantity,
      isAvailable: item.isAvailable,
      imageUri: item.imageUri,
    }],
  };
}

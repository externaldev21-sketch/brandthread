/**
 * Sell-an-item taxonomy — the option lists behind the Category, Size,
 * Condition, Colour, Material and Parcel size rows. Field set and wording
 * follow Vinted's "Sell an item" form and Depop's category drill-down
 * (Department → Category → Subcategory). Values are what the API stores in
 * `products.listing_details` (see api-server lib/listingDetails.ts).
 */

export type Department = 'Women' | 'Men' | 'Unisex' | 'Kids';
export const DEPARTMENTS: Department[] = ['Women', 'Men', 'Unisex', 'Kids'];

export type SizeSystem = 'clothing' | 'waist' | 'footwear' | 'one-size';

export interface CategoryNode {
  name: string;
  sizes: SizeSystem;
  subcategories: string[];
}

const TOPS: CategoryNode = { name: 'Tops', sizes: 'clothing', subcategories: ['T-shirts', 'Shirts', 'Polo shirts', 'Tank tops', 'Long-sleeve tops', 'Crop tops', 'Blouses'] };
const SWEATS: CategoryNode = { name: 'Sweatshirts & hoodies', sizes: 'clothing', subcategories: ['Hoodies', 'Sweatshirts', 'Zip-ups', 'Fleeces'] };
const KNIT: CategoryNode = { name: 'Knitwear', sizes: 'clothing', subcategories: ['Jumpers', 'Cardigans', 'Knitted vests'] };
const OUTER: CategoryNode = { name: 'Coats & jackets', sizes: 'clothing', subcategories: ['Jackets', 'Coats', 'Puffer jackets', 'Bomber jackets', 'Denim jackets', 'Gilets', 'Blazers'] };
const BOTTOMS: CategoryNode = { name: 'Bottoms', sizes: 'waist', subcategories: ['Jeans', 'Trousers', 'Cargo pants', 'Joggers', 'Shorts', 'Leggings'] };
const SKIRTS: CategoryNode = { name: 'Skirts', sizes: 'clothing', subcategories: ['Mini skirts', 'Midi skirts', 'Maxi skirts'] };
const DRESSES: CategoryNode = { name: 'Dresses', sizes: 'clothing', subcategories: ['Mini dresses', 'Midi dresses', 'Maxi dresses', 'Jumpsuits & playsuits'] };
const ACTIVE: CategoryNode = { name: 'Activewear', sizes: 'clothing', subcategories: ['Sports tops', 'Sports bras', 'Sports shorts', 'Tracksuits'] };
const SWIM: CategoryNode = { name: 'Swimwear', sizes: 'clothing', subcategories: ['Swimsuits', 'Bikinis', 'Swim shorts'] };
const FOOTWEAR: CategoryNode = { name: 'Footwear', sizes: 'footwear', subcategories: ['Sneakers', 'Boots', 'Sandals', 'Slides', 'Loafers', 'Heels'] };
const BAGS: CategoryNode = { name: 'Bags', sizes: 'one-size', subcategories: ['Tote bags', 'Shoulder bags', 'Crossbody bags', 'Backpacks', 'Wallets'] };
const ACCESSORIES: CategoryNode = { name: 'Accessories', sizes: 'one-size', subcategories: ['Hats & caps', 'Beanies', 'Belts', 'Scarves', 'Sunglasses', 'Socks'] };
const JEWELLERY: CategoryNode = { name: 'Jewellery', sizes: 'one-size', subcategories: ['Necklaces', 'Rings', 'Bracelets', 'Earrings', 'Watches'] };

export const CATEGORY_TREE: Record<Department, CategoryNode[]> = {
  Women: [TOPS, SWEATS, KNIT, OUTER, BOTTOMS, SKIRTS, DRESSES, ACTIVE, SWIM, FOOTWEAR, BAGS, ACCESSORIES, JEWELLERY],
  Men: [TOPS, SWEATS, KNIT, OUTER, BOTTOMS, ACTIVE, SWIM, FOOTWEAR, BAGS, ACCESSORIES, JEWELLERY],
  Unisex: [TOPS, SWEATS, KNIT, OUTER, BOTTOMS, ACTIVE, FOOTWEAR, BAGS, ACCESSORIES, JEWELLERY],
  Kids: [TOPS, SWEATS, OUTER, BOTTOMS, DRESSES, FOOTWEAR, ACCESSORIES],
};

export function findCategory(department: string | undefined, category: string | undefined): CategoryNode | undefined {
  if (!department || !category) return undefined;
  return CATEGORY_TREE[department as Department]?.find(c => c.name === category);
}

/** "Men / Tops / T-shirts" — Depop's drafts-row breadcrumb. */
export function categoryPath(department?: string, category?: string, subcategory?: string): string {
  return [department, category, subcategory].filter(Boolean).join(' / ');
}

export const SIZE_OPTIONS: Record<SizeSystem, string[]> = {
  clothing: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  waist: ['W24', 'W26', 'W28', 'W30', 'W32', 'W34', 'W36', 'W38', 'W40'],
  footwear: ['US 5', 'US 6', 'US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12', 'US 13'],
  'one-size': ['One size'],
};

export function sizeOptionsFor(department?: string, category?: string): string[] {
  return SIZE_OPTIONS[findCategory(department, category)?.sizes ?? 'clothing'];
}

export type ListingCondition = 'new_with_tags' | 'new_without_tags' | 'very_good' | 'good' | 'satisfactory';

/** Vinted's condition scale, word for word in spirit. */
export const CONDITIONS: { value: ListingCondition; label: string; description: string }[] = [
  { value: 'new_with_tags', label: 'New with tags', description: 'A brand-new, unused item with tags attached or in the original packaging.' },
  { value: 'new_without_tags', label: 'New without tags', description: 'A brand-new, unused item without tags or original packaging.' },
  { value: 'very_good', label: 'Very good', description: 'A lightly used item that may have slight imperfections, but still looks great.' },
  { value: 'good', label: 'Good', description: 'A used item that may show imperfections and signs of wear.' },
  { value: 'satisfactory', label: 'Satisfactory', description: 'A frequently used item with imperfections and signs of wear.' },
];

export function conditionLabel(value?: string | null): string | undefined {
  return CONDITIONS.find(c => c.value === value)?.label;
}

export const MAX_COLORS = 2;

/** Swatch colours are data (what the buyer will see), not theme colours. */
export const COLORS: { name: string; hex: string }[] = [
  { name: 'Black', hex: '#111111' },
  { name: 'White', hex: '#F7F7F7' },
  { name: 'Grey', hex: '#9A9A9A' },
  { name: 'Silver', hex: '#C4C4C4' },
  { name: 'Cream', hex: '#EFE6D2' },
  { name: 'Beige', hex: '#D9C3A0' },
  { name: 'Brown', hex: '#7A4E2D' },
  { name: 'Navy', hex: '#1B2A4A' },
  { name: 'Blue', hex: '#2F6FD6' },
  { name: 'Light blue', hex: '#9CC7F0' },
  { name: 'Green', hex: '#2E7D4F' },
  { name: 'Khaki', hex: '#8A8456' },
  { name: 'Yellow', hex: '#F2CF3B' },
  { name: 'Orange', hex: '#EE7A2C' },
  { name: 'Red', hex: '#C9252C' },
  { name: 'Burgundy', hex: '#6D1A36' },
  { name: 'Pink', hex: '#F2A2BF' },
  { name: 'Purple', hex: '#6E4AA8' },
  { name: 'Gold', hex: '#C9A54A' },
  { name: 'Multi', hex: '' },
];

export const MATERIALS: string[] = [
  'Cotton', 'Organic cotton', 'Denim', 'Linen', 'Wool', 'Cashmere', 'Silk', 'Leather',
  'Faux leather', 'Suede', 'Polyester', 'Nylon', 'Fleece', 'Jersey', 'Corduroy', 'Velvet', 'Canvas',
];

export type ParcelSize = 'small' | 'medium' | 'large';
/** Vinted's "Parcel size" screen. */
export const PARCEL_SIZES: { value: ParcelSize; label: string; description: string }[] = [
  { value: 'small', label: 'Small', description: "For items that'd fit in a large envelope." },
  { value: 'medium', label: 'Medium', description: "For items that'd fit in a shoebox." },
  { value: 'large', label: 'Large', description: "For items that'd fit in a moving box." },
];

export type ShippingPayer = 'buyer' | 'seller';
export const SHIPPING_PAYERS: { value: ShippingPayer; label: string; description: string }[] = [
  { value: 'buyer', label: 'Buyer pays', description: 'Shipping is added to the order at checkout.' },
  { value: 'seller', label: 'I pay (free shipping)', description: 'Buyers see free shipping. The cost comes out of your earnings.' },
];

export function parcelLabel(value?: string | null): string | undefined {
  return PARCEL_SIZES.find(p => p.value === value)?.label;
}

export const MAX_PHOTOS = 8;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 1000;
